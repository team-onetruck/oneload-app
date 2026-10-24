/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 다운로드 계약·미측정 값·중복 회차·기기 정보 충돌과 잘못된 복원을 검증한다
 */
import { describe, expect, it } from 'vitest'
import { createManifest, downloadName, parseSurvey, prepareTrial, putTrial, serializeSurvey } from './model'
import type { SurveyForm } from './model'

export const form: SurveyForm = {
  surveyId: 'SS-test', collector: '답사자', deviceId: 'phone-A', model: '현장 확인 기종', osVersion: '확인한 OS 버전', browser: 'Chrome', browserVersion: '확인한 버전',
  nodeId: 'node-A', nodeName: '답사 지점', floorId: 'B2', standing: '기둥 앞', posture: 'rear_camera_forward_portrait', repeat: '1', duration: '10',
  target: '통로 끝 고정 기둥', referenceDeg: '', referenceNorth: 'unknown', referenceSource: '', notes: '자석 케이스 없음',
}
const at = '2026-10-24T03:00:00.000Z'

describe('답사 기록 계약', () => {
  it('센서만 기록한 manifest도 기존 전체 수집 스키마로 내보내며 좌표·방향은 지어내지 않는다', () => {
    const { manifest, trial } = prepareTrial(createManifest(form.surveyId), form, 'trial-A', at, 0, '시험 UA')
    trial.result = 'unsupported'
    const output = parseSurvey(serializeSurvey(putTrial(manifest, trial), at))
    expect(output).toMatchObject({ schema_version: '1.0.0', data_kind: 'field', map_id: 'seoul-station', ended_at: at })
    expect(output.nodes[0].position_m).toBeNull()
    expect(output.floors[0].elevation_m).toBeNull()
    expect(output.compass_trials[0].reference_heading.deg).toBeNull()
    expect(output.coordinate_frame.north_reference).toBe('unresolved')
  })

  it('기준 각도 0도를 미입력과 구분하고 출처 ID를 연결한다', () => {
    const prepared = prepareTrial(createManifest(form.surveyId), { ...form, referenceDeg: '0', referenceNorth: 'true_north', referenceSource: '독립 실측 도면' }, 'trial-A', at, 0, 'UA')
    const output = parseSurvey(serializeSurvey(putTrial(prepared.manifest, prepared.trial), at))
    expect(output.compass_trials[0].reference_heading).toMatchObject({ deg: 0, reference: 'true_north', source_ids: ['trial-A-bearing-source'] })
    expect(output.sources[0].locator).toBe('독립 실측 도면')
  })

  it('같은 지점·기기·자세·회차의 재사용과 기기 메타데이터 변경을 막는다', () => {
    const { manifest, trial } = prepareTrial(createManifest(form.surveyId), form, 'trial-A', at, 0, 'UA')
    const stored = putTrial(manifest, trial)
    expect(() => prepareTrial(stored, form, 'trial-B', at, 0, 'UA')).toThrow('회차')
    expect(() => prepareTrial(stored, { ...form, repeat: '2', model: '다른 기종' }, 'trial-B', at, 0, 'UA')).toThrow('기기 ID')
    expect(() => prepareTrial(stored, { ...form, repeat: '2', floorId: 'B3' }, 'trial-B', at, 0, 'UA')).toThrow('다른 층')
  })

  it('모호한 기준 방향과 잘못된 기록 시간을 거부한다', () => {
    for (const override of [{ referenceDeg: '90' }, { referenceDeg: '360' }, { duration: '0' }, { duration: '121' }, { repeat: '1.5' }, { model: ' ' }])
      expect(() => prepareTrial(createManifest(form.surveyId), { ...form, ...override }, 'trial-A', at, 0, 'UA')).toThrow()
  })

  it('추가 키·누락 키·위조 참조가 있는 JSON과 예시 데이터는 복원하지 않는다', () => {
    const prepared = prepareTrial(createManifest(form.surveyId), form, 'trial-A', at, 0, 'UA')
    const good = putTrial(prepared.manifest, prepared.trial)
    expect(() => parseSurvey(JSON.stringify({ ...good, extra: true }))).toThrow('스키마')
    expect(() => parseSurvey(JSON.stringify({ ...good, data_kind: 'example' }))).toThrow('field')
    const missing = structuredClone(good)
    missing.nodes = []
    expect(() => parseSurvey(JSON.stringify(missing))).toThrow('참조')
  })

  it('다운로드 이름에서 경로 구분자를 제거하고 한글 ID는 보존한다', () => {
    expect(downloadName('../서울역/시험', at)).toBe('.._서울역_시험-sensors-2026-10-24T03-00-00-000Z.json')
  })
})
