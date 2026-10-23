/**
 * Date: 2026-10-23
 * Author: Jung Minkyu
 * Purpose: FormData를 정한 경계값으로 직접 multipart 본문으로 만든다. 같은 Idempotency-Key로 재시도하면 같은 바이트가 나가게 한다
 */

// 경계값(RFC 2046)이면서 Content-Type 헤더에 따옴표 없이 쓸 수 있는 문자만 남기고 나머지는 _로 바꾼다. 길이는 70자까지다.
const BOUNDARY_UNSAFE = /[^0-9A-Za-z'+_\-.]/g
const MAX_BOUNDARY_LENGTH = 70

// 서버 지문은 경로 + Authorization + 본문 바이트라서(backend/app/middleware.py) 경계값도 재시도마다 같아야 한다.
export function boundaryFor(idempotencyKey: string): string {
  return `oneload-${idempotencyKey.replace(BOUNDARY_UNSAFE, '_')}`.slice(0, MAX_BOUNDARY_LENGTH)
}

// 아래 규칙은 fetch가 FormData를 직렬화하는 방식(HTML 표준 multipart/form-data encoding)과 같다.
// 필드 이름과 문자열 값의 줄바꿈은 CRLF로 맞추고, 이름과 파일명의 CR, LF, "는 퍼센트 인코딩한다.
const toCrlf = (text: string) => text.replace(/\r\n|\r|\n/g, '\r\n')
const escapeQuoted = (text: string) => text.replace(/\n/g, '%0A').replace(/\r/g, '%0D').replace(/"/g, '%22')

export interface MultipartBody {
  body: Blob
  contentType: string
}

// 사진은 미리 읽지 않고 Blob 조각으로 이어 붙인다. 같은 FormData와 경계값이면 같은 바이트가 된다.
export function encodeMultipart(form: FormData, boundary: string): MultipartBody {
  const parts: BlobPart[] = []
  for (const [name, value] of form.entries()) {
    const disposition = `--${boundary}\r\nContent-Disposition: form-data; name="${escapeQuoted(toCrlf(name))}"`
    if (typeof value === 'string') {
      parts.push(`${disposition}\r\n\r\n${toCrlf(value)}\r\n`)
    } else {
      // FormData에 넣은 Blob은 이름이 blob인 File이 된다. 서버(Starlette)는 filename이 있어야 파일(UploadFile)로 읽는다.
      const type = value.type || 'application/octet-stream'
      parts.push(`${disposition}; filename="${escapeQuoted(value.name)}"\r\nContent-Type: ${type}\r\n\r\n`, value, '\r\n')
    }
  }
  parts.push(`--${boundary}--\r\n`)
  return { body: new Blob(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}
