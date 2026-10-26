using System;

namespace Hangil.MarkerCore
{
    // Unity·서버 없이 검사하는 미터 단위 yaw 정합이다. +z에서 +x 방향으로 회전한다.
    public struct Point3
    {
        public double X, Y, Z;
        public Point3(double x, double y, double z) { X = x; Y = y; Z = z; }
        public static Point3 operator +(Point3 a, Point3 b) { return new Point3(a.X + b.X, a.Y + b.Y, a.Z + b.Z); }
        public static Point3 operator -(Point3 a, Point3 b) { return new Point3(a.X - b.X, a.Y - b.Y, a.Z - b.Z); }
        public bool IsFinite { get { return MarkerMath.Finite(X) && MarkerMath.Finite(Y) && MarkerMath.Finite(Z); } }
    }

    public struct YawAlignment
    {
        public double YawDeg;
        public Point3 Translation;
        public Point3 ToAr(Point3 point) { return MarkerMath.Rotate(point, YawDeg) + Translation; }
        public Point3 ToMap(Point3 point) { return MarkerMath.Rotate(point - Translation, -YawDeg); }
    }

    public static class MarkerMath
    {
        public static bool Finite(double n) { return !double.IsNaN(n) && !double.IsInfinity(n); }
        public static double Normalize(double yaw) { return ((yaw % 360) + 360) % 360; }
        public static Point3 Rotate(Point3 p, double yaw)
        {
            double angle = yaw * Math.PI / 180;
            return new Point3(Math.Cos(angle) * p.X + Math.Sin(angle) * p.Z, p.Y, -Math.Sin(angle) * p.X + Math.Cos(angle) * p.Z);
        }

        public static YawAlignment Align(Point3 markerMap, double mapYaw, Point3 markerAr, double arYaw)
        {
            if (!markerMap.IsFinite || !markerAr.IsFinite || !Finite(mapYaw) || !Finite(arYaw)) throw new ArgumentException("유한한 지도·마커 포즈가 필요합니다.");
            double yaw = Normalize(arYaw - mapYaw);
            var result = new YawAlignment { YawDeg = yaw, Translation = markerAr - Rotate(markerMap, yaw) };
            if (!result.Translation.IsFinite) throw new ArgumentException("정합 계산 범위를 초과했습니다.");
            return result;
        }
    }

    // 앵커 생성이 늦게 끝나거나 취소돼도 이전 결과를 재사용하지 않는다.
    public sealed class ExperimentLifetime
    {
        public int Generation { get; private set; }
        public bool Active { get; private set; }
        public void Reset() { Generation++; Active = false; }
        public bool Accept(int generation) { if (generation != Generation) return false; Active = true; return true; }
        public bool CanRender(int generation, bool sessionTracking, bool anchorTracking, double ageSeconds, double travelM)
        {
            // 실험 종료 한도이며 QA가 승인한 운영 품질 기준이 아니다.
            bool valid = generation == Generation && Active && sessionTracking && anchorTracking &&
                MarkerMath.Finite(ageSeconds) && ageSeconds >= 0 && ageSeconds <= 30 &&
                MarkerMath.Finite(travelM) && travelM >= 0 && travelM <= 3;
            if (!valid) Reset();
            return valid;
        }
    }
}
