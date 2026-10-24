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
            Console.WriteLine("C# 공통 로직 " + checks + "개 통과. Unity·Android 런타임 검증은 포함하지 않습니다.");
            return 0;
        }
        catch (Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
