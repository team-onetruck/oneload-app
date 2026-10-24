using System;
using System.Collections.Generic;
using System.Globalization;
using Hangil.MarkerCore;
using Unity.XR.CoreUtils;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Hangil.MarkerSpike
{
    // 운영 길안내가 아닌 한 마커·한 화살표 측정 앱이다. 서버나 TS 런타임을 호출하지 않는다.
    public sealed class MarkerSpike : MonoBehaviour
    {
        public ARSession Session;
        public XROrigin Origin;
        public ARTrackedImageManager Images;
        public ARAnchorManager Anchors;
        public ARCameraManager CameraManager;
        public Material ArrowMaterial;

        const string TargetName = "hangil-wall-target";
        const float TargetWidthM = 0.18f;
        readonly ExperimentLifetime lifetime = new ExperimentLifetime();
        readonly List<ARAnchor> retiredAnchors = new List<ARAnchor>();
        ARTrackedImage observed;
        ARAnchor anchor;
        GameObject mapRoot;
        Mesh arrowMesh;
        string sessionId;
        string alignmentId;
        string status = "Scan the printed target, upright on a wall.";
        string heightText = "1.20";
        string distanceText = "1.00";
        float markerHeightM;
        float arrowDistanceM;
        double alignedAt;
        bool anchorEverTracked;
        double lastCameraFrame = -100;
        Vector3 cameraAtAlignment;
        Vector3 markerMap;
        bool pending;
        bool measurementsConfirmed;
        bool quitting;

        void OnEnable()
        {
            sessionId = Guid.NewGuid().ToString();
            Images.trackablesChanged.AddListener(OnImages);
            CameraManager.frameReceived += OnCameraFrame;
            ARSession.stateChanged += OnSessionState;
        }

        void OnDisable()
        {
            Images.trackablesChanged.RemoveListener(OnImages);
            CameraManager.frameReceived -= OnCameraFrame;
            ARSession.stateChanged -= OnSessionState;
            ClearAlignment("Experiment stopped. Scan and align again.");
        }

        void OnCameraFrame(ARCameraFrameEventArgs args)
        {
            // 촬영 포즈 동기화의 증거가 아니다. 카메라 공급이 멈췄는지만 감시한다.
            lastCameraFrame = Time.realtimeSinceStartupAsDouble;
        }

        void OnSessionState(ARSessionStateChangedEventArgs args)
        {
            if (args.state != ARSessionState.SessionTracking)
            {
                sessionId = Guid.NewGuid().ToString();
                observed = null;
                ClearAlignment("Session not tracking. Scan and align again.");
            }
        }

        void OnImages(ARTrackablesChangedEventArgs<ARTrackedImage> changes)
        {
            foreach (var image in changes.added) Observe(image);
            foreach (var image in changes.updated) Observe(image);
            foreach (var removed in changes.removed)
                if (observed != null && removed.Key == observed.trackableId) observed = null;
        }

        void Observe(ARTrackedImage image)
        {
            if (image.referenceImage.name == TargetName) observed = image;
        }

        bool OriginIsIdentity()
        {
            return Origin != null && Origin.Camera != null &&
                Origin.transform.position.sqrMagnitude < 0.000001f &&
                Quaternion.Angle(Origin.transform.rotation, Quaternion.identity) < 0.01f &&
                (Origin.transform.lossyScale - Vector3.one).sqrMagnitude < 0.000001f &&
                Origin.CameraYOffset == 0 && Origin.RequestedTrackingOriginMode == XROrigin.TrackingOriginMode.Device;
        }

        bool CanAlign()
        {
            if (!measurementsConfirmed || pending || observed == null || observed.trackingState != TrackingState.Tracking ||
                ARSession.state != ARSessionState.SessionTracking || !OriginIsIdentity() ||
                Time.realtimeSinceStartupAsDouble - lastCameraFrame > 0.5 || Anchors.subsystem == null) return false;
            // Unity의 추적 이미지 +y는 앞면 법선, +z는 인쇄물 위쪽이다. 원시 ARCore 포즈가 아니다.
            return Vector3.Angle(observed.transform.forward, Vector3.up) <= 10 &&
                Mathf.Abs(Vector3.Dot(observed.transform.up, Vector3.up)) < 0.18f &&
                Mathf.Abs(observed.referenceImage.size.x - TargetWidthM) < 0.0001f;
        }

        async void Align()
        {
            if (!CanAlign()) return;
            ClearAlignment("Creating a native AR anchor...");
            pending = true;
            int ticket = lifetime.Generation;
            string captureSessionId = sessionId;
            var image = observed;
            var front = Vector3.ProjectOnPlane(image.transform.up, Vector3.up).normalized;
            float yaw = Mathf.Atan2(front.x, front.z) * Mathf.Rad2Deg;
            markerMap = new Vector3(0, markerHeightM, 0);
            YawAlignment transform;
            try
            {
                // SDK가 정규화한 이미지의 월드 포즈를 사용한다. 최신 카메라 포즈와 재합성하지 않는다.
                transform = MarkerMath.Align(ToPoint(markerMap), 0, ToPoint(image.transform.position), yaw);
                var mapPose = new Pose(ToVector(transform.Translation), Quaternion.Euler(0, (float)transform.YawDeg, 0));
                var result = await Anchors.TryAddAnchorAsync(new Pose(image.transform.position, mapPose.rotation));
                if (this == null || !isActiveAndEnabled || captureSessionId != sessionId || ticket != lifetime.Generation)
                {
                    if (result.status.IsSuccess() && result.value != null) RetireAnchor(result.value);
                    return;
                }
                pending = false;
                if (!result.status.IsSuccess() || result.value == null)
                {
                    ClearAlignment("Anchor creation failed. Try scanning again.");
                    return;
                }
                anchor = result.value;
                if (image == null || image.trackingState != TrackingState.Tracking || !OriginIsIdentity())
                {
                    ClearAlignment("Marker or origin changed while creating anchor.");
                    return;
                }
                mapRoot = new GameObject("MapRootInAnchor");
                mapRoot.transform.SetPositionAndRotation(mapPose.position, mapPose.rotation);
                // 월드 포즈를 유지해 앵커 상대 변환을 한 번만 저장한다. 이후 앵커 갱신은 부모가 처리한다.
                mapRoot.transform.SetParent(anchor.transform, true);
                BuildArrow(mapRoot.transform, arrowDistanceM);
                mapRoot.SetActive(false);
                alignmentId = Guid.NewGuid().ToString();
                cameraAtAlignment = Origin.Camera.transform.position;
                alignedAt = Time.realtimeSinceStartupAsDouble;
                anchorEverTracked = false;
                lifetime.Accept(ticket);
                status = "EXPERIMENT ONLY: compare the arrow with your floor tape.";
                Debug.Log("[HangilMarker] aligned session=" + sessionId + " alignment=" + alignmentId + " anchor=" + anchor.trackableId + " quality=unverified");
            }
            catch (Exception error)
            {
                if (this != null && ticket == lifetime.Generation)
                {
                    ClearAlignment("Alignment failed. See device log.");
                    Debug.LogException(error);
                }
            }
        }

        void Update()
        {
            ReleaseRetiredAnchors();
            if (mapRoot == null || anchor == null) return;
            double now = Time.realtimeSinceStartupAsDouble;
            bool tracking = ARSession.state == ARSessionState.SessionTracking && OriginIsIdentity() && now - lastCameraFrame <= 0.5;
            bool anchorTracking = anchor.trackingState == TrackingState.Tracking;
            // 앵커가 처음 유효해질 때까지는 숨긴 채 기다린다. 한번 유효했던 앵커의 유실에는 적용하지 않는다.
            if (tracking && !anchorEverTracked && !anchorTracking && now - alignedAt < 3) return;
            if (anchorTracking) anchorEverTracked = true;
            double travel = Vector3.Distance(cameraAtAlignment, Origin.Camera.transform.position);
            if (!lifetime.CanRender(lifetime.Generation, tracking, anchorTracking, now - alignedAt, travel))
            {
                ClearAlignment("Tracking/anchor/time/distance invalid. Scan and align again.");
                return;
            }
            // 인쇄물을 움직이면 기존 바닥 좌표가 무효다. 마커가 다시 관측될 때만 비교한다.
            if (observed != null && observed.trackingState == TrackingState.Tracking &&
                Vector3.Distance(mapRoot.transform.TransformPoint(markerMap), observed.transform.position) > 0.15f)
            {
                ClearAlignment("Marker moved or alignment drifted. Align again.");
                return;
            }
            mapRoot.SetActive(true);
        }

        void ClearAlignment(string message)
        {
            lifetime.Reset();
            pending = false;
            if (mapRoot != null) { mapRoot.SetActive(false); Destroy(mapRoot); }
            if (arrowMesh != null) Destroy(arrowMesh);
            if (anchor != null) RetireAnchor(anchor);
            anchor = null;
            mapRoot = null;
            alignmentId = null;
            status = message;
        }

        void RetireAnchor(ARAnchor value)
        {
            if (value != null && !retiredAnchors.Contains(value)) retiredAnchors.Add(value);
            ReleaseRetiredAnchors();
        }

        void ReleaseRetiredAnchors()
        {
            // 비활성화된 매니저에서 제거 API를 호출하면 예외가 난다. 복귀 후 업데이트에서 정리한다.
            if (Anchors == null || !Anchors.isActiveAndEnabled || Anchors.subsystem == null) return;
            for (int i = retiredAnchors.Count - 1; i >= 0; i--)
            {
                if (retiredAnchors[i] == null || Anchors.TryRemoveAnchor(retiredAnchors[i])) retiredAnchors.RemoveAt(i);
            }
        }

        void OnApplicationPause(bool paused) { if (paused) ClearAlignment("App paused. Scan and align again."); }
        void OnApplicationFocus(bool focused) { if (!focused) ClearAlignment("App lost focus. Scan and align again."); }
        void OnApplicationQuit() { quitting = true; }

        void BuildArrow(Transform parent, float forwardM)
        {
            var go = new GameObject("FixedFloorArrow");
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(0, 0.01f, forwardM);
            var mesh = new Mesh();
            arrowMesh = mesh;
            mesh.name = "HangilFloorArrow";
            mesh.vertices = new[] {
                new Vector3(-0.09f,0,-0.3f), new Vector3(0.09f,0,-0.3f), new Vector3(-0.09f,0,0.04f), new Vector3(0.09f,0,0.04f),
                new Vector3(-0.23f,0,0.04f), new Vector3(0.23f,0,0.04f), new Vector3(0,0,0.3f)
            };
            mesh.triangles = new[] {0,2,1,1,2,3,4,6,5,0,1,2,1,3,2,4,5,6};
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            go.AddComponent<MeshRenderer>().sharedMaterial = ArrowMaterial;
        }

        void OnGUI()
        {
            if (quitting) return;
            var old = GUI.matrix;
            float scale = Screen.width / 500f;
            GUI.matrix = Matrix4x4.Scale(new Vector3(scale, scale, 1));
            GUILayout.BeginArea(new Rect(12, 30, 476, 480), GUI.skin.box);
            GUILayout.Label("HANGIL MARKER LAB / NOT NAVIGATION");
            GUILayout.Label("Accuracy unverified. Target width: 18.0 cm.");
            GUILayout.Label(status);
            GUI.enabled = !pending && mapRoot == null;
            GUILayout.Label("Measured marker centre height above floor (m)");
            heightText = GUILayout.TextField(heightText);
            GUILayout.Label("Arrow centre distance outward from wall (m)");
            distanceText = GUILayout.TextField(distanceText);
            measurementsConfirmed = GUILayout.Toggle(measurementsConfirmed, "I measured the print width, height and floor point.");
            bool numbers = float.TryParse(heightText, NumberStyles.Float, CultureInfo.InvariantCulture, out markerHeightM) && markerHeightM >= 0.3f && markerHeightM <= 2.5f &&
                float.TryParse(distanceText, NumberStyles.Float, CultureInfo.InvariantCulture, out arrowDistanceM) && arrowDistanceM >= 0.3f && arrowDistanceM <= 2f;
            GUI.enabled = numbers && CanAlign();
            if (GUILayout.Button("ALIGN MARKER - SHOW TEST ARROW", GUILayout.Height(48))) Align();
            GUI.enabled = true;
            if (GUILayout.Button("HIDE / REALIGN", GUILayout.Height(42))) ClearAlignment("Scan and align again.");
            GUILayout.EndArea();
            GUI.matrix = old;
        }

        static Point3 ToPoint(Vector3 v) { return new Point3(v.x, v.y, v.z); }
        static Vector3 ToVector(Point3 p) { return new Vector3((float)p.X, (float)p.Y, (float)p.Z); }
    }
}
