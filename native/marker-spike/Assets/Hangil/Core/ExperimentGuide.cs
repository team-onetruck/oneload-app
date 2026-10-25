using System;
using System.Globalization;

namespace Hangil.MarkerCore
{
    public enum GuideState
    {
        Measurements, Confirmation, Permission, Unsupported, Session, Camera,
        Origin, FindMarker, MarkerPose, Ready, CreatingAnchor, WaitingAnchor, Active
    }

    public static class ExperimentGuide
    {
        public static bool TryMeasurements(string height, string distance, out float heightM, out float distanceM)
        {
            // Decimal keyboards can produce either separator. Thousands and non-finite values are invalid.
            return Parse(height, 0.3f, 2.5f, out heightM) & Parse(distance, 0.3f, 2f, out distanceM);
        }

        static bool Parse(string text, float min, float max, out float value)
        {
            return float.TryParse((text ?? "").Trim().Replace(',', '.'),
                NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out value) &&
                MarkerMath.Finite(value) && value >= min && value <= max;
        }

        public static GuideState State(bool active, bool waitingAnchor, bool pending, bool measurements,
            bool confirmed, bool permission, bool supported, bool tracking, bool cameraFresh,
            bool originValid, bool markerTracked, bool markerUpright)
        {
            if (active) return GuideState.Active;
            if (waitingAnchor) return GuideState.WaitingAnchor;
            if (pending) return GuideState.CreatingAnchor;
            if (!measurements) return GuideState.Measurements;
            if (!confirmed) return GuideState.Confirmation;
            if (!supported) return GuideState.Unsupported;
            if (!permission) return GuideState.Permission;
            if (!tracking) return GuideState.Session;
            if (!cameraFresh) return GuideState.Camera;
            if (!originValid) return GuideState.Origin;
            if (!markerTracked) return GuideState.FindMarker;
            return markerUpright ? GuideState.Ready : GuideState.MarkerPose;
        }

        public static string Hint(GuideState state, bool ko)
        {
            switch (state)
            {
                case GuideState.Measurements: return ko ? "벽 그림 중심 높이(0.3~2.5m)와 바닥 목표 거리(0.3~2m)를 입력하세요." : "Enter marker centre height (0.3–2.5m) and floor target distance (0.3–2m).";
                case GuideState.Confirmation: return ko ? "그림 너비 18cm와 입력한 거리를 줄자로 확인한 뒤 체크하세요." : "Measure the 18cm print width and both distances, then confirm below.";
                case GuideState.Permission: return ko ? "카메라를 시작하지 못했습니다. 휴대폰 설정에서 카메라 권한을 허용하고 앱을 다시 여세요." : "Camera unavailable. Allow camera access in phone settings, then reopen the app.";
                case GuideState.Unsupported: return ko ? "이 기기에서 AR을 사용할 수 없습니다. AR 지원과 서비스 설치 상태를 확인하세요." : "AR is unavailable. Check device support and AR service installation.";
                case GuideState.Session: return ko ? "밝은 곳에서 바닥과 벽을 천천히 비춰 주세요." : "Slowly scan a well-lit floor and wall to start tracking.";
                case GuideState.Camera: return ko ? "카메라 영상을 기다리고 있어요. 렌즈를 가리지 말고 잠시 기다리세요." : "Waiting for the camera. Uncover the lens and wait a moment.";
                case GuideState.Origin: return ko ? "AR 설정을 확인해야 합니다. 실험 장면을 다시 생성해 주세요." : "AR setup needs attention. Recreate the experiment scene.";
                case GuideState.FindMarker: return ko ? "벽에 붙인 그림 전체가 화면에 들어오도록 비춰 주세요." : "Point the camera at the whole printed picture on the wall.";
                case GuideState.MarkerPose: return ko ? "그림을 수직 벽에 평평하게 붙이고 위쪽 방향을 맞춰 주세요." : "Keep the picture flat on a vertical wall, with its top edge up.";
                case GuideState.Ready: return ko ? "그림을 찾았어요. 멈춰 선 상태에서 화살표를 표시하세요." : "Picture found. Stand still and show the test arrow.";
                case GuideState.CreatingAnchor: return ko ? "화살표 위치를 맞추고 있어요. 휴대폰을 잠시 고정하세요." : "Placing the arrow. Hold the phone still for a moment.";
                case GuideState.WaitingAnchor: return ko ? "공간 추적을 확인하고 있어요. 잠시 기다리세요." : "Checking the anchor. Please wait a moment.";
                default: return ko ? "화살표 중심과 바닥 표시를 비교하세요. 최대 30초·3m 안에서만 확인하세요." : "Compare the arrow centre with the floor mark, within 30 seconds and 3 metres.";
            }
        }
    }
}
