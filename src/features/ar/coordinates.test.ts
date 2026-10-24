/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 비원점 마커·회전 부호·촬영 포즈·앵커 갱신·현재 위치 역변환을 수치 검증한다
 */
import { describe, expect, it } from 'vitest'
import { arFixture, pose } from '../../test/fixtures/ar'
import { alignMarker, compose, currentMapPosition, headingDeg, inverse, mapPoseAr, transformPoint, yawRotation } from './coordinates'

describe('지도와 AR 좌표', () => {
  it('북쪽을 +90도 돌리면 동쪽이며 역변환은 원래 좌표를 복구한다', () => {
    const transform = pose({ x: 10, y: 2, z: 20 }, 90)
    const point = { x: 0, y: -6, z: 4 }
    expect(transformPoint(transform, point)).toEqual({ x: 14, y: -4, z: 20 })
    const restored = transformPoint(inverse(transform), transformPoint(transform, point))
    expect(restored.x).toBeCloseTo(point.x)
    expect(restored.y).toBeCloseTo(point.y)
    expect(restored.z).toBeCloseTo(point.z)
  })

  it('지도 원점 밖의 벽 마커와 촬영 포즈를 합성해 +90도·평행이동을 얻는다', () => {
    const { renderInput: { alignment, frame } } = arFixture()
    const transform = mapPoseAr(alignment, frame.anchor!)
    expect(transform.position.x).toBeCloseTo(10)
    expect(transform.position.y).toBeCloseTo(2)
    expect(transform.position.z).toBeCloseTo(20)
    expect(headingDeg(transform.rotation)).toBeCloseTo(90)
  })

  it('마커 노드 대신 현재 카메라 위치를 역변환하고 바닥 높이로 보행 좌표를 정한다', () => {
    const { renderInput: { alignment, frame } } = arFixture()
    frame.cameraPoseAr.position = { x: 12, y: 3.6, z: 19 }
    const current = currentMapPosition(alignment, frame, frame.anchor!, 0)
    expect(current.positionMapM.x).toBeCloseTo(1)
    expect(current.positionMapM.z).toBeCloseTo(2)
    expect(current.positionMapM.y).toBe(0)
    expect(current.headingDeg).toBeCloseTo(0)
  })

  it('최신 앵커 이동·회전을 한 번만 적용한다', () => {
    const { renderInput: { alignment, frame } } = arFixture()
    frame.anchor!.poseAr = pose({ x: 11, y: 2, z: 20 }, 40)
    const updated = mapPoseAr(alignment, frame.anchor!)
    expect(updated.position.x).toBeCloseTo(11)
    expect(headingDeg(updated.rotation)).toBeCloseTo(100)
  })

  it.each(['frameId', 'capturedAtMs', 'arSessionId'] as const)('촬영과 검출의 %s가 다르면 정합하지 않는다', (key) => {
    const { alignmentInput: input } = arFixture()
    const observation = { ...input.observation, [key]: key === 'capturedAtMs' ? 1001 : '다른 프레임' }
    expect(alignMarker({ ...input, observation })).toMatchObject({ ok: false })
  })

  it('검출 완료 시각의 새 카메라 프레임으로 촬영 포즈를 바꾸면 거부한다', () => {
    const { alignmentInput: input } = arFixture()
    expect(alignMarker({ ...input, capture: { ...input.capture, frameId: 'latest-frame', capturedAtMs: 1010 } })).toEqual({ ok: false, reason: 'capture_mismatch' })
  })

  it('마커 실제 크기와 검출기 사용 크기가 다르면 거부한다', () => {
    const { alignmentInput: input } = arFixture()
    input.observation.sizeUsedM = 0.21
    expect(alignMarker(input)).toEqual({ ok: false, reason: 'marker_metadata' })
  })

  it('기울거나 뒤집힌 마커를 수직 벽 마커로 받아들이지 않는다', () => {
    const { alignmentInput: input } = arFixture()
    input.observation.markerPoseCamera.rotation = { x: 1, y: 0, z: 0, w: 0 }
    expect(alignMarker(input)).toEqual({ ok: false, reason: 'marker_tilt' })
  })

  it('비정규 회전·무한 좌표는 계산에 사용하지 않는다', () => {
    const { alignmentInput: input } = arFixture()
    input.capture.cameraPoseAr.rotation.w = 2
    expect(alignMarker(input)).toEqual({ ok: false, reason: 'invalid_pose' })
    input.capture.cameraPoseAr = pose({ x: Infinity, y: 0, z: 0 })
    expect(alignMarker(input)).toEqual({ ok: false, reason: 'invalid_pose' })
  })

  it('여러 yaw에서도 포즈 합성과 역변환이 일치한다', () => {
    for (const yaw of [0, 45, 90, 180, 270, 359]) {
      const transform = pose({ x: -13, y: -4, z: 7 }, yaw)
      const camera = pose({ x: 2, y: 1.6, z: 5 }, 37)
      const restored = compose(inverse(transform), compose(transform, camera))
      expect(restored.position.x).toBeCloseTo(camera.position.x)
      expect(restored.position.z).toBeCloseTo(camera.position.z)
      expect(headingDeg(restored.rotation)).toBeCloseTo(headingDeg(yawRotation(37))!)
    }
  })
})
