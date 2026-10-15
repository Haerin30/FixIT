export async function api(path, { token, method = 'GET', body, signal } = {}) {
  const controller = new AbortController()
  const cancel = () => controller.abort()
  if (signal?.aborted) cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(cancel, 20000)
  try {
    const response = await fetch(`${import.meta.env.VITE_API_URL || '/api'}${path}`, { method, signal: controller.signal, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      const error = Object.assign(new Error(data.message || `Request failed (${response.status})`), { status: response.status })
      if (response.status === 401 && token && typeof window !== 'undefined') window.dispatchEvent(new Event('fixit:session-expired'))
      throw error
    }
    return data.data
  } catch (error) {
    if (error.name === 'AbortError') throw new Error(signal?.aborted ? 'Request cancelled.' : 'The request timed out. Check your connection and retry.', { cause: error })
    if (error instanceof TypeError) throw new Error('Cannot reach FixIT. Check your connection and that the API server is running.', { cause: error })
    throw error
  } finally { clearTimeout(timeout); signal?.removeEventListener('abort', cancel) }
}
