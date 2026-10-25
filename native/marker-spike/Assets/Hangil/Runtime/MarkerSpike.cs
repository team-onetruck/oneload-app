using System;
using System.Collections.Generic;
using Hangil.MarkerCore;
using Unity.XR.CoreUtils;
using Unity.Profiling;
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
        static readonly ProfilerMarker FrameMarker = new ProfilerMarker("Hangil.Marker.Frame");
        static readonly ProfilerMarker HudMarker = new ProfilerMarker("Hangil.Marker.Hud");
        readonly ExperimentLifetime lifetime = new ExperimentLifetime();
        readonly List<ARAnchor> retiredAnchors = new List<ARAnchor>();
        ARTrackedImage observed;
        ARAnchor anchor;
        GameObject mapRoot;
        Mesh arrowMesh;
        string sessionId;
        string alignmentId;
        MarkerHud hud;
        string koNotice, enNotice;
        float markerHeightM;
        float arrowDistanceM;
        double alignedAt;
        bool anchorEverTracked;
        double lastCameraFrame = -100;
        Vector3 cameraAtAlignment;
        Vector3 markerMap;
        bool pending;
        GameObject arrow;
        double nextHudUpdate;
        double anchorRequestedAt;
        double enabledAt;

        void Awake()
        {
            hud = gameObject.AddComponent<MarkerHud>();
            hud.AlignRequested += Align;
            hud.ResetRequested += Retry;
            hud.MeasurementsChanged += OnMeasurementsChanged;
            // One immutable mesh per experiment lifetime, reused across all realignments.
            BuildArrow();
        }

        void OnEnable()
        {
            sessionId = Guid.NewGuid().ToString();
            enabledAt = Time.realtimeSinceStartupAsDouble;
            nextHudUpdate = 0;
            hud.SetVisible(true);
            Images.trackablesChanged.AddListener(OnImages);
            CameraManager.frameReceived += OnCameraFrame;
            ARSession.stateChanged += OnSessionState;
        }

        void OnDisable()
        {
            Images.trackablesChanged.RemoveListener(OnImages);
            CameraManager.frameReceived -= OnCameraFrame;
            ARSession.stateChanged -= OnSessionState;
            ClearAlignment("실험을 멈췄어요. 그림을 다시 비춰 주세요.", "Experiment stopped. Scan the picture again.");
            hud.SetVisible(false);
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
                ClearAlignment("공간 추적이 중단되어 화살표를 숨겼어요.", "Tracking stopped. The arrow has been hidden.");
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
            return Guide() == GuideState.Ready;
        }

        GuideState Guide()
        {
            bool measurements = ExperimentGuide.TryMeasurements(hud.Height, hud.Distance, out markerHeightM, out arrowDistanceM);
            bool tracked = observed != null && observed.trackingState == TrackingState.Tracking;
            return ExperimentGuide.State(mapRoot != null && mapRoot.activeSelf, mapRoot != null, pending,
                measurements, hud.Confirmed, CameraManager.permissionGranted || Time.realtimeSinceStartupAsDouble - enabledAt < 8,
                ARSession.state != ARSessionState.Unsupported,
                ARSession.state == ARSessionState.SessionTracking && Anchors.subsystem != null,
                Time.realtimeSinceStartupAsDouble - lastCameraFrame <= 0.5, OriginIsIdentity(), tracked, tracked && MarkerUpright());
        }

        bool MarkerUpright()
        {
            // Unity의 추적 이미지 +y는 앞면 법선, +z는 인쇄물 위쪽이다. 원시 ARCore 포즈가 아니다.
            return Vector3.Angle(observed.transform.forward, Vector3.up) <= 10 &&
                Mathf.Abs(Vector3.Dot(observed.transform.up, Vector3.up)) < 0.18f &&
                Mathf.Abs(observed.referenceImage.size.x - TargetWidthM) < 0.0001f;
        }

        async void Align()
        {
            if (!isActiveAndEnabled || !CanAlign()) return;
            ClearAlignment(null, null);
            pending = true;
            anchorRequestedAt = Time.realtimeSinceStartupAsDouble;
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
                    ClearAlignment("위치를 고정하지 못했어요. 밝은 곳에서 다시 시도하세요.", "Could not place the arrow. Try again in a well-lit area.");
                    return;
                }
                anchor = result.value;
                if (image == null || image.trackingState != TrackingState.Tracking || !OriginIsIdentity())
                {
                    ClearAlignment("그림을 놓쳤어요. 그림 전체를 비추고 다시 시도하세요.", "Picture lost. Scan the whole picture and try again.");
                    return;
                }
                mapRoot = new GameObject("MapRootInAnchor");
                mapRoot.transform.SetPositionAndRotation(mapPose.position, mapPose.rotation);
                // 월드 포즈를 유지해 앵커 상대 변환을 한 번만 저장한다. 이후 앵커 갱신은 부모가 처리한다.
                mapRoot.transform.SetParent(anchor.transform, true);
                if (arrow == null) BuildArrow();
                arrow.transform.SetParent(mapRoot.transform, false);
                arrow.transform.localPosition = new Vector3(0, 0.01f, arrowDistanceM);
                arrow.SetActive(true);
                mapRoot.SetActive(false);
                alignmentId = Guid.NewGuid().ToString();
                cameraAtAlignment = Origin.Camera.transform.position;
                alignedAt = Time.realtimeSinceStartupAsDouble;
                anchorEverTracked = false;
                lifetime.Accept(ticket);
                koNotice = enNotice = null;
                Debug.Log("[HangilMarker] aligned session=" + sessionId + " alignment=" + alignmentId + " anchor=" + anchor.trackableId + " quality=unverified");
            }
            catch (Exception error)
            {
                if (this != null && ticket == lifetime.Generation)
                {
                    ClearAlignment("위치를 맞추지 못했어요. 그림을 다시 비추고 재시도하세요.", "Placement failed. Scan the picture and try again.");
                    Debug.LogException(error);
                }
            }
        }

        void Update()
        {
            using (FrameMarker.Auto()) UpdateExperiment();
        }

        void UpdateExperiment()
        {
            ReleaseRetiredAnchors();
            double now = Time.realtimeSinceStartupAsDouble;
            // A hung provider must not lock the only action indefinitely. Late results still use the generation guard.
            if (pending && now - anchorRequestedAt > 8)
                ClearAlignment("응답이 늦어 취소했어요. 다시 시도할 수 있어요.", "Placement timed out. You can try again.");
            if (now >= nextHudUpdate)
            {
                nextHudUpdate = now + 0.25;
                using (HudMarker.Auto())
                    hud.Present(Guide(), koNotice, enNotice, mapRoot != null ? 30 - (now - alignedAt) : 0);
            }
            if (mapRoot == null || anchor == null)
            {
                if (lifetime.Active) ClearAlignment("고정 위치를 잃었어요. 그림을 다시 맞춰 주세요.", "Anchor lost. Scan and realign the picture.");
                return;
            }
            bool tracking = ARSession.state == ARSessionState.SessionTracking && OriginIsIdentity() && now - lastCameraFrame <= 0.5;
            bool anchorTracking = anchor.trackingState == TrackingState.Tracking;
            // 앵커가 처음 유효해질 때까지는 숨긴 채 기다린다. 한번 유효했던 앵커의 유실에는 적용하지 않는다.
            if (tracking && !anchorEverTracked && !anchorTracking && now - alignedAt < 3) return;
            if (anchorTracking) anchorEverTracked = true;
            double travel = Vector3.Distance(cameraAtAlignment, Origin.Camera.transform.position);
            if (!lifetime.CanRender(lifetime.Generation, tracking, anchorTracking, now - alignedAt, travel))
            {
                if (now - alignedAt > 30)
                    ClearAlignment("30초 확인을 마쳤어요. 계속하려면 그림을 다시 맞추세요.", "30-second check complete. Realign to continue.");
                else if (travel > 3)
                    ClearAlignment("확인 범위 3m를 벗어났어요. 그림 가까이에서 다시 맞추세요.", "Beyond the 3m test range. Return to the picture and realign.");
                else
                    ClearAlignment("추적이 불안정해 화살표를 숨겼어요. 바닥과 그림을 다시 비춰 주세요.", "Tracking became unreliable. Arrow hidden. Scan the floor and picture again.");
                return;
            }
            // 인쇄물을 움직이면 기존 바닥 좌표가 무효다. 마커가 다시 관측될 때만 비교한다.
            if (observed != null && observed.trackingState == TrackingState.Tracking &&
                Vector3.Distance(mapRoot.transform.TransformPoint(markerMap), observed.transform.position) > 0.15f)
            {
                ClearAlignment("그림 위치가 달라졌어요. 실측 위치를 확인하고 다시 맞추세요.", "Picture position changed. Check the setup and realign.");
                return;
            }
            if (!mapRoot.activeSelf) { mapRoot.SetActive(true); nextHudUpdate = 0; }
        }

        void ClearAlignment(string ko, string en)
        {
            lifetime.Reset();
            pending = false;
            if (arrow != null) { arrow.SetActive(false); arrow.transform.SetParent(transform, false); }
            if (mapRoot != null) { mapRoot.SetActive(false); Destroy(mapRoot); }
            if (anchor != null) RetireAnchor(anchor);
            anchor = null;
            mapRoot = null;
            alignmentId = null;
            koNotice = ko; enNotice = en;
            nextHudUpdate = 0;
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

        void Retry()
        {
            bool reviewing = !pending && mapRoot == null;
            ClearAlignment(null, null);
            observed = null;
            if (reviewing) hud.RecheckMeasurements();
        }

        void OnMeasurementsChanged()
        {
            if (pending || mapRoot != null) ClearAlignment(null, null);
            else { koNotice = enNotice = null; nextHudUpdate = 0; }
        }

        void OnApplicationPause(bool paused) { if (paused) ClearAlignment("앱을 다시 열었어요. 그림을 다시 맞춰 주세요.", "App interrupted. Realign the picture to continue."); }
        void OnApplicationFocus(bool focused) { if (!focused) ClearAlignment("화면을 벗어나 화살표를 숨겼어요. 그림을 다시 맞춰 주세요.", "App lost focus. Arrow hidden. Realign to continue."); }

        void OnDestroy()
        {
            if (arrowMesh != null) Destroy(arrowMesh);
        }

        void BuildArrow()
        {
            var go = new GameObject("FixedFloorArrow");
            arrow = go;
            go.transform.SetParent(transform, false);
            go.SetActive(false);
            if (arrowMesh == null)
            {
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
            }
            go.AddComponent<MeshFilter>().sharedMesh = arrowMesh;
            var renderer = go.AddComponent<MeshRenderer>();
            renderer.sharedMaterial = ArrowMaterial;
            renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            renderer.receiveShadows = false;
        }

        static Point3 ToPoint(Vector3 v) { return new Point3(v.x, v.y, v.z); }
        static Vector3 ToVector(Point3 p) { return new Vector3((float)p.X, (float)p.Y, (float)p.Z); }
    }
}
