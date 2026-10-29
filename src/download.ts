export function downloadBlob(data: ArrayBuffer | Blob, name: string) {
  const url = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type: 'model/stl' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}
