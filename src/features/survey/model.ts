/**
 * Date: 2026-10-24
 * Author: Jung Minkyu
 * Purpose: 답사 입력과 방향 시험을 수집 스키마에 맞추고 검증·복원·다운로드할 JSON을 만든다
 */
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import schema from './survey.schema.json'
import template from './survey.template.json'

export type Posture = 'rear_camera_forward_portrait' | 'flat_screen_up'
export interface RawSample {
  elapsed_ms: number
  event_type: 'deviceorientation' | 'deviceorientationabsolute'
  absolute: boolean | null
  alpha: number | null
  beta: number | null
  gamma: number | null
  webkit_compass_heading: number | null
  webkit_compass_accuracy: number | null
  derived_rear_heading_deg: number | null
}
export interface Bearing {
  deg: number | null
  reference: 'true_north' | 'magnetic_north' | 'map_axis' | 'unknown'
  method: string
  source_ids: string[]
  uncertainty_deg: number | null
}
export interface CompassTrial {
  trial_id: string
  node_id: string
  device_id: string
  started_at: string | null
  repeat_index: number
  posture: Posture
  screen_angle_deg: number
  reference_target_description: string
  reference_heading: Bearing
  sensor_reference: 'magnetic_north' | 'true_north' | 'implementation_defined' | 'unknown'
  normalization_to_map_deg: number | null
  normalization_source_ids: string[]
  result: 'readings' | 'denied' | 'unsupported' | 'error'
  samples: RawSample[]
  notes: string
}
export interface SurveyDevice {
  device_id: string
  role: 'browser_test'
  model: string
  os_version: string | null
  browser: string | null
  browser_version: string | null
  app_build: string | null
}
export interface SurveyNode {
  node_id: string
  floor_id: string
  name: { ko: string; en: string | null }
  position_m: { x: number; y: number; z: number } | null
  position_method: string
  position_uncertainty_m: number | null
  standing_description: string
  area: 'free' | 'paid' | 'unknown'
  proof: { status: string; source_ids: string[]; evidence_asset_ids: string[]; checked_by: string | null; checked_at: string | null; notes: string }
}
export interface SurveyManifest {
  schema_version: '1.0.0'
  data_kind: 'field'
  survey_id: string
  map_id: 'seoul-station'
  started_at: string | null
  ended_at: string | null
  collectors: string[]
  scope_description: string
  site_access_notes: string
  coordinate_frame: typeof template.coordinate_frame
  devices: SurveyDevice[]
  sources: { source_id: string; kind: string; locator: string; checked_at: string | null; notes: string }[]
  floors: { floor_id: string; elevation_m: number | null; elevation_method: string; source_ids: string[] }[]
  nodes: SurveyNode[]
  edges: unknown[]
  landmarks: unknown[]
  assets: unknown[]
  compass_trials: CompassTrial[]
  route_trials: unknown[]
}
export interface SurveyForm {
  surveyId: string
  collector: string
  deviceId: string
  model: string
  osVersion: string
  browser: string
  browserVersion: string
  nodeId: string
  nodeName: string
  floorId: string
  standing: string
  posture: Posture
  repeat: string
  duration: string
  target: string
  referenceDeg: string
  referenceNorth: Bearing['reference']
  referenceSource: string
  notes: string
}

// survey-kit/survey.schema.json 1.0.0의 배포용 사본이다. 기존 기록을 바꾸거나 숫자로 강제 변환하지 않는다.
const ajv = new Ajv2020({ allErrors: true, strict: false })
addFormats(ajv)
const validate = ajv.compile<SurveyManifest>(schema)

export function assertManifest(value: unknown): asserts value is SurveyManifest {
  if (!validate(value)) throw new Error(`수집 스키마 오류: ${ajv.errorsText(validate.errors, { separator: '; ' })}`)
  if (value.data_kind !== 'field') throw new Error('실제 field 기록만 불러올 수 있습니다. 예시·템플릿은 사용할 수 없습니다.')
  for (const [items, key] of [[value.nodes, 'node_id'], [value.devices, 'device_id'], [value.floors, 'floor_id'], [value.sources, 'source_id'], [value.compass_trials, 'trial_id']] as const) {
    const ids = items.map((item) => (item as unknown as Record<string, unknown>)[key])
    if (new Set(ids).size !== ids.length) throw new Error(`중복된 ID: ${key}`)
  }
  const nodes = new Set(value.nodes.map((node) => node.node_id))
  const devices = new Set(value.devices.map((device) => device.device_id))
  const floors = new Set(value.floors.map((floor) => floor.floor_id))
  const sources = new Set(value.sources.map((source) => source.source_id))
  for (const node of value.nodes) if (!floors.has(node.floor_id)) throw new Error(`알 수 없는 층: ${node.floor_id}`)
  for (const trial of value.compass_trials) {
    if (!nodes.has(trial.node_id) || !devices.has(trial.device_id)) throw new Error(`시험의 지점·기기 참조 오류: ${trial.trial_id}`)
    if (trial.reference_heading.source_ids.some((id) => !sources.has(id))) throw new Error(`기준 방향의 출처 참조 오류: ${trial.trial_id}`)
    if (trial.result === 'readings' && !trial.samples.length) throw new Error('방향 이벤트가 없는 readings 기록입니다.')
    if (trial.samples.some((sample, index) => index > 0 && sample.elapsed_ms < trial.samples[index - 1].elapsed_ms)) throw new Error('방향 이벤트 시각이 역전돼 있습니다.')
  }
}

export function createManifest(surveyId: string): SurveyManifest {
  return {
    ...structuredClone(template),
    schema_version: '1.0.0', data_kind: 'field', map_id: 'seoul-station', survey_id: surveyId,
    coordinate_frame: { ...template.coordinate_frame, frame_id: `${surveyId}-unresolved`, origin_description: '센서 답사 기록. 지도 원점과 북쪽은 아직 측정하지 않음.' },
    scope_description: '서울역 브라우저 방향 이벤트 현장 측정',
  }
}

export function prepareTrial(manifest: SurveyManifest, form: SurveyForm, id: string, at: string, screenAngle: number, userAgent: string) {
  const required = [form.surveyId, form.collector, form.deviceId, form.model, form.osVersion, form.browser, form.browserVersion, form.nodeId, form.nodeName, form.floorId, form.standing]
  if (required.some((value) => !value.trim())) throw new Error('답사·담당자·기기·지점의 필수 항목을 입력하세요.')
  if (form.surveyId.trim() !== manifest.survey_id) throw new Error('새 답사는 새 기록을 만든 뒤 시작하세요.')
  const repeat = Number(form.repeat)
  const duration = Number(form.duration)
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 9999) throw new Error('반복 회차는 1~9999의 정수로 입력하세요.')
  if (!Number.isFinite(duration) || duration < 1 || duration > 120) throw new Error('기록 시간은 1~120초로 입력하세요.')
  if (manifest.compass_trials.some((trial) => trial.node_id === form.nodeId.trim() && trial.device_id === form.deviceId.trim() && trial.posture === form.posture && trial.repeat_index === repeat)) throw new Error('같은 지점·기기·자세·회차의 기록이 있습니다. 회차를 올려 주세요.')
  const deg = form.referenceDeg.trim() === '' ? null : Number(form.referenceDeg)
  if (deg !== null && (!Number.isFinite(deg) || deg < 0 || deg >= 360 || form.referenceNorth === 'unknown' || !form.referenceSource.trim() || !form.target.trim())) throw new Error('기준 방향은 0 이상 360 미만이며, 북쪽 기준·독립 출처·조준 대상을 함께 입력해야 합니다.')
  const next = structuredClone(manifest)
  const node = next.nodes.find((item) => item.node_id === form.nodeId.trim())
  if (node && node.floor_id !== form.floorId.trim()) throw new Error('같은 지점 ID에 다른 층을 사용할 수 없습니다. 지점 ID를 확인하세요.')
  const device: SurveyDevice = { device_id: form.deviceId.trim(), role: 'browser_test', model: form.model.trim(), os_version: form.osVersion.trim(), browser: form.browser.trim(), browser_version: form.browserVersion.trim(), app_build: `sensor-survey-v1 / ${__APP_VERSION__}` }
  const existingDevice = next.devices.find((item) => item.device_id === device.device_id)
  if (existingDevice && (['model', 'os_version', 'browser', 'browser_version'] as const).some((key) => existingDevice[key] !== device[key])) throw new Error('같은 기기 ID의 기종·OS·브라우저 정보가 다릅니다. 새 기기 ID를 사용하세요.')
  if (!existingDevice) next.devices.push(device)
  if (!next.floors.some((item) => item.floor_id === form.floorId.trim())) next.floors.push({ floor_id: form.floorId.trim(), elevation_m: null, elevation_method: 'not_measured', source_ids: [] })
  if (!node) next.nodes.push({ node_id: form.nodeId.trim(), floor_id: form.floorId.trim(), name: { ko: form.nodeName.trim(), en: null }, position_m: null, position_method: 'not_measured', position_uncertainty_m: null, standing_description: form.standing.trim(), area: 'unknown', proof: { status: 'draft', source_ids: [], evidence_asset_ids: [], checked_by: null, checked_at: null, notes: '센서 측정 장소의 사용자 입력. 좌표·유무료 구역은 미측정.' } })
  else if (node.standing_description !== form.standing.trim() || node.name.ko !== form.nodeName.trim()) throw new Error('기존 지점의 이름·서 있는 위치와 다릅니다. 기존 설명을 사용하거나 새 지점 ID를 부여하세요.')
  const sourceIds = deg === null ? [] : [`${id}-bearing-source`]
  if (deg !== null) next.sources.push({ source_id: sourceIds[0], kind: 'field_measurement', locator: form.referenceSource.trim(), checked_at: at, notes: '담당자가 입력한 기준 방향 근거. 시험 대상 폰과 독립적인지 별도 검토 필요.' })
  if (!next.collectors.includes(form.collector.trim())) next.collectors.push(form.collector.trim())
  next.started_at ??= at
  next.ended_at = null
  const trial: CompassTrial = {
    trial_id: id, node_id: form.nodeId.trim(), device_id: device.device_id, started_at: at,
    repeat_index: repeat, posture: form.posture, screen_angle_deg: screenAngle,
    reference_target_description: form.target.trim() || '기준 대상 미입력',
    reference_heading: { deg, reference: deg === null ? 'unknown' : form.referenceNorth, method: deg === null ? 'not_measured' : 'collector_supplied_reference', source_ids: sourceIds, uncertainty_deg: null },
    sensor_reference: 'unknown', normalization_to_map_deg: null, normalization_source_ids: [], result: 'error', samples: [],
    notes: `${form.notes.trim()}\n기록 미완료. 종료 전 중단되면 복구한 부분 기록으로 취급.\n담당자: ${form.collector.trim()}\n조준 위치: ${form.standing.trim()}\nUA: ${userAgent}`.trim(),
  }
  return { manifest: next, trial, durationMs: duration * 1000 }
}

export function putTrial(manifest: SurveyManifest, trial: CompassTrial): SurveyManifest {
  const trials = manifest.compass_trials.filter((item) => item.trial_id !== trial.trial_id)
  return { ...manifest, compass_trials: [...trials, trial] }
}

export function serializeSurvey(manifest: SurveyManifest, endedAt: string): string {
  const finished = { ...manifest, ended_at: endedAt }
  assertManifest(finished)
  return JSON.stringify(finished, null, 2) + '\n'
}

export function parseSurvey(text: string): SurveyManifest {
  const parsed: unknown = JSON.parse(text)
  assertManifest(parsed)
  return parsed
}

export function downloadName(surveyId: string, at: string): string {
  const safeId = surveyId.replace(/[^\p{L}\p{N}_.-]/gu, '_').slice(0, 80) || 'survey'
  return `${safeId}-sensors-${at.replace(/[:.]/g, '-')}.json`
}
