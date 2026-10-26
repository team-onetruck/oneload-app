using System;
using Hangil.MarkerCore;

static class Program
{
    static int checks;
    static void Check(string name, bool condition)
    {
        if (!condition) throw new Exception("실패: " + name);
        checks++;
        Console.WriteLine("통과: " + name);
    }
    static bool Near(double a, double b) { return Math.Abs(a - b) < 0.000001; }
    static int Main()
    {
        try
        {
            var r = MarkerMath.Rotate(new Point3(0, 0, 1), 90);
            Check("북쪽에서 +90도는 동쪽", Near(r.X, 1) && Near(r.Z, 0));
            var align = MarkerMath.Align(new Point3(2, 1.5, 3), 90, new Point3(13, 3.5, 18), 180);
            Check("비원점 마커의 정합 yaw", Near(align.YawDeg, 90));
            Check("비원점 마커의 평행이동", Near(align.Translation.X, 10) && Near(align.Translation.Y, 2) && Near(align.Translation.Z, 20));
            var point = align.ToMap(new Point3(12, 3.6, 19));
            Check("현재 카메라 역변환", Near(point.X, 1) && Near(point.Y, 1.6) && Near(point.Z, 2));
            var floor = MarkerMath.Align(new Point3(0, 1.2, 0), 0, new Point3(5, 2.8, 8), 90).ToAr(new Point3(0, 0, 1));
            Check("실측 마커 높이로 바닥 화살표 계산", Near(floor.X, 6) && Near(floor.Y, 1.6) && Near(floor.Z, 8));
            foreach (double yaw in new[] { 0d, 45d, 90d, 180d, 270d, 359d })
            {
                var t = MarkerMath.Align(new Point3(2, 1, 3), 0, new Point3(-8, 4, 2), yaw);
                var p = new Point3(4, -12, 9);
                var back = t.ToMap(t.ToAr(p));
                Check("여러 방향의 왕복 변환 " + yaw, Near(back.X, p.X) && Near(back.Y, p.Y) && Near(back.Z, p.Z));
            }
            bool rejected = false;
            try { MarkerMath.Align(new Point3(double.NaN, 1, 0), 0, new Point3(), 0); }
            catch (ArgumentException) { rejected = true; }
            Check("비정상 수치 거부", rejected);
            var life = new ExperimentLifetime();
            int old = life.Generation;
            life.Reset();
            Check("취소 뒤 비동기 앵커 결과 폐기", !life.Accept(old));
            Check("새 앵커 결과 채택", life.Accept(life.Generation));
            Check("유효한 추적에서 렌더", life.CanRender(life.Generation, true, true, 1, 1));
            Check("추적 유실 즉시 숨김", !life.CanRender(life.Generation, false, true, 1, 1));
            Check("자동 추적 복구만으로 재사용 금지", !life.CanRender(life.Generation, true, true, 2, 1));
            life.Accept(life.Generation);
            Check("앵커 유실 숨김", !life.CanRender(life.Generation, true, false, 1, 1));
            life.Accept(life.Generation);
            Check("30초 실험 한도", !life.CanRender(life.Generation, true, true, 31, 1));
            life.Accept(life.Generation);
            Check("3미터 실험 한도", !life.CanRender(life.Generation, true, true, 1, 3.1));
            life.Accept(life.Generation);
            Check("알 수 없는 시각 거부", !life.CanRender(life.Generation, true, true, double.NaN, 1));
            float height, distance;
            Check("실측 높이 미입력 시 진행 차단", !ExperimentGuide.TryMeasurements("", "1.00", out height, out distance));
            Check("소수점 쉼표 키보드 지원", ExperimentGuide.TryMeasurements("1,25", "0,80", out height, out distance) && Near(height, 1.25) && Math.Abs(distance - 0.8) < 0.00001);
            foreach (string invalid in new[] { "NaN", "Infinity", "1e2", "1,200.00", "-1", "0", "2.51", "1..2" })
                Check("잘못된 높이 거부 " + invalid, !ExperimentGuide.TryMeasurements(invalid, "1", out height, out distance));
            Check("거리 상한 확인", !ExperimentGuide.TryMeasurements("1.2", "2.01", out height, out distance));
            Check("입력 경계 포함", ExperimentGuide.TryMeasurements("0.3", "2", out height, out distance));
            Check("준비된 경우만 진행", ExperimentGuide.State(false, false, false, true, true, true, true, true, true, true, true, true) == GuideState.Ready);
            Check("미확인 측정 진행 금지", ExperimentGuide.State(false, false, false, true, false, true, true, true, true, true, true, true) == GuideState.Confirmation);
            Check("카메라 권한 복구 안내", ExperimentGuide.State(false, false, false, true, true, false, true, true, true, true, true, true) == GuideState.Permission);
            Check("지원 안됨 안내 우선", ExperimentGuide.State(false, false, false, true, true, false, false, true, true, true, true, true) == GuideState.Unsupported);
            Check("카메라 공급 중단 차단", ExperimentGuide.State(false, false, false, true, true, true, true, true, false, true, true, true) == GuideState.Camera);
            Check("잘못된 그림 자세 차단", ExperimentGuide.State(false, false, false, true, true, true, true, true, true, true, true, false) == GuideState.MarkerPose);
            Check("비동기 생성 중 중복 시작 금지", ExperimentGuide.State(false, false, true, true, true, true, true, true, true, true, true, true) == GuideState.CreatingAnchor);
            Check("앵커 최초 추적 전 숨김 안내", ExperimentGuide.State(false, true, false, true, true, true, true, true, true, true, true, true) == GuideState.WaitingAnchor);
            foreach (GuideState state in Enum.GetValues(typeof(GuideState)))
                Check("모든 상태의 한영 복구 안내 " + state, !string.IsNullOrWhiteSpace(ExperimentGuide.Hint(state, true)) && !string.IsNullOrWhiteSpace(ExperimentGuide.Hint(state, false)));
            Console.WriteLine("C# 공통 로직 " + checks + "개 통과. Unity·Android 런타임 검증은 포함하지 않습니다.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
