using System;
using System.IO;
using Hangil.MarkerSpike;
using Unity.XR.CoreUtils;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.Build.Reporting;
using UnityEditor.SceneManagement;
using UnityEditor.XR.ARSubsystems;
using UnityEditor.XR.Management;
using UnityEngine;
using UnityEngine.InputSystem;
using UnityEngine.InputSystem.XR;
using UnityEngine.Rendering;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace Hangil.MarkerSpike.Editor
{
    public static class MarkerSpikeBuilder
    {
        const string Generated = "Assets/Hangil/Generated";
        const string ScenePath = Generated + "/MarkerSpike.unity";

        [MenuItem("Hangil/Create Marker Experiment Scene")]
        public static void CreateScene()
        {
            if (!Application.isBatchMode && !EditorSceneManager.SaveCurrentModifiedScenesIfUserWantsTo()) return;
            Directory.CreateDirectory(Generated);
            AssetDatabase.Refresh();
            var target = AssetDatabase.LoadAssetAtPath<Texture2D>("Assets/Hangil/Target/hangil-target.jpg");
            if (target == null) throw new InvalidOperationException("기준 이미지가 없습니다.");
            var library = AssetDatabase.LoadAssetAtPath<XRReferenceImageLibrary>(Generated + "/TargetLibrary.asset");
            if (library == null)
            {
                library = ScriptableObject.CreateInstance<XRReferenceImageLibrary>();
                library.Add();
                AssetDatabase.CreateAsset(library, Generated + "/TargetLibrary.asset");
            }
            library.SetTexture(0, target, false);
            library.SetName(0, "hangil-wall-target");
            library.SetSpecifySize(0, true);
            library.SetSize(0, new Vector2(0.18f, 0.18f * target.height / target.width));
            EditorUtility.SetDirty(library);

            var material = AssetDatabase.LoadAssetAtPath<Material>(Generated + "/Arrow.mat");
            if (material == null)
            {
                var shader = Shader.Find("Unlit/Color");
                if (shader == null) throw new InvalidOperationException("Built-in 렌더 파이프라인의 Unlit/Color 셰이더가 필요합니다.");
                material = new Material(shader);
                material.color = new Color(0.1f, 1f, 0.35f);
                AssetDatabase.CreateAsset(material, Generated + "/Arrow.mat");
            }

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);
            var session = new GameObject("AR Session").AddComponent<ARSession>();
            session.gameObject.AddComponent<ARInputManager>();
            var originObject = new GameObject("XR Origin");
            originObject.SetActive(false);
            var origin = originObject.AddComponent<XROrigin>();
            var offset = new GameObject("Camera Offset");
            offset.transform.SetParent(originObject.transform, false);
            origin.CameraFloorOffsetObject = offset;
            origin.RequestedTrackingOriginMode = XROrigin.TrackingOriginMode.Device;
            origin.CameraYOffset = 0;
            var cameraObject = new GameObject("AR Camera");
            cameraObject.transform.SetParent(offset.transform, false);
            cameraObject.tag = "MainCamera";
            var camera = cameraObject.AddComponent<Camera>();
            camera.nearClipPlane = 0.05f;
            camera.farClipPlane = 30;
            camera.allowHDR = false;
            camera.allowMSAA = false;
            origin.Camera = camera;
            var cameraManager = cameraObject.AddComponent<ARCameraManager>();
            cameraObject.AddComponent<ARCameraBackground>();
            var driver = cameraObject.AddComponent<TrackedPoseDriver>();
            driver.positionInput = new InputActionProperty(new InputAction("Head Position", InputActionType.Value, "<XRHMD>/centerEyePosition"));
            driver.rotationInput = new InputActionProperty(new InputAction("Head Rotation", InputActionType.Value, "<XRHMD>/centerEyeRotation"));
            driver.trackingStateInput = new InputActionProperty(new InputAction("Head Tracking", InputActionType.Value, "<XRHMD>/trackingState"));
            var imageManager = originObject.AddComponent<ARTrackedImageManager>();
            imageManager.referenceLibrary = library;
            imageManager.requestedMaxNumberOfMovingImages = 1;
            var anchorManager = originObject.AddComponent<ARAnchorManager>();
            var experiment = originObject.AddComponent<global::Hangil.MarkerSpike.MarkerSpike>();
            experiment.Session = session;
            experiment.Origin = origin;
            experiment.Images = imageManager;
            experiment.Anchors = anchorManager;
            experiment.CameraManager = cameraManager;
            experiment.ArrowMaterial = material;
            originObject.SetActive(true);

            PlayerSettings.companyName = "Hangil";
            PlayerSettings.productName = "Hangil Marker Lab";
            PlayerSettings.SetApplicationIdentifier(NamedBuildTarget.Android, "com.hangil.markerspike");
            PlayerSettings.SetScriptingBackend(NamedBuildTarget.Android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24;
            PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevelAuto;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.Portrait;
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.OpenGLES3 });
            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            AssetDatabase.SaveAssets();
            Debug.Log("[HangilMarker] 장면 생성 완료. Android XR Plug-in Management에서 ARCore를 활성화하고 Project Validation을 확인하세요.");
        }

        [MenuItem("Hangil/Build Android APK")]
        public static void BuildAndroid()
        {
            var settings = XRGeneralSettingsPerBuildTarget.XRGeneralSettingsForBuildTarget(BuildTargetGroup.Android);
            bool hasArCore = false;
            if (settings != null && settings.Manager != null)
                foreach (var loader in settings.Manager.activeLoaders)
                    if (loader != null && loader.GetType().FullName == "UnityEngine.XR.ARCore.ARCoreLoader") hasArCore = true;
            if (!hasArCore) throw new InvalidOperationException("Android의 ARCore XR Loader를 먼저 활성화하세요.");
            if (!File.Exists(ScenePath)) CreateScene();
            Directory.CreateDirectory("Builds");
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions {
                scenes = new[] { ScenePath }, locationPathName = "Builds/HangilMarkerLab.apk",
                target = BuildTarget.Android, options = BuildOptions.Development
            });
            if (report.summary.result != BuildResult.Succeeded) throw new InvalidOperationException("Android APK 빌드 실패: " + report.summary.result);
        }
    }
}
