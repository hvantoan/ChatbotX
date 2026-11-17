import type http from "node:http"
import https from "node:https"
import net from "node:net"
import type { Duplex } from "node:stream"
import tls from "node:tls"

const HTTP_200_STATUS_RE = /^HTTP\/\d\.\d 200\b/

/**
 * Minimal HTTP CONNECT tunneling agent for http/https proxy URLs without extra deps.
 * Never logs proxy credentials.
 */
export function createProxyAgent(proxyUrl: string): http.Agent {
  const parsed = new URL(proxyUrl)
  const proxyHost = parsed.hostname
  const proxyPort = Number(
    parsed.port || (parsed.protocol === "https:" ? 443 : 80),
  )
  const isHttpsProxy = parsed.protocol === "https:"
  const authHeader =
    parsed.username || parsed.password
      ? `Basic ${Buffer.from(
          `${decodeURIComponent(parsed.username)}:${decodeURIComponent(parsed.password)}`,
        ).toString("base64")}`
      : undefined

  class ConnectProxyAgent extends https.Agent {
    override createConnection(
      options: http.ClientRequestArgs & tls.ConnectionOptions,
      callback?: (err: Error | null, stream: Duplex) => void,
    ): Duplex {
      const targetHost = options.host ?? options.hostname ?? "localhost"
      const targetPort = Number(options.port ?? 443)

      const connectSocket = isHttpsProxy
        ? tls.connect({ host: proxyHost, port: proxyPort })
        : net.connect({ host: proxyHost, port: proxyPort })

      const onError = (err: Error) => {
        connectSocket.destroy()
        callback?.(err, connectSocket)
      }

      connectSocket.once("error", onError)
      connectSocket.once("connect", () => {
        const headers = [
          `CONNECT ${targetHost}:${targetPort} HTTP/1.1`,
          `Host: ${targetHost}:${targetPort}`,
        ]
        if (authHeader) {
          headers.push(`Proxy-Authorization: ${authHeader}`)
        }
        headers.push("", "")
        connectSocket.write(headers.join("\r\n"))

        let buffer = ""
        const onData = (chunk: Buffer) => {
          buffer += chunk.toString("latin1")
          const headerEnd = buffer.indexOf("\r\n\r\n")
          if (headerEnd === -1) {
            return
          }
          connectSocket.removeListener("data", onData)
          connectSocket.removeListener("error", onError)

          const statusLine = buffer.slice(0, buffer.indexOf("\r\n"))
          if (!HTTP_200_STATUS_RE.test(statusLine)) {
            connectSocket.destroy()
            callback?.(
              new Error(`Proxy CONNECT failed: ${statusLine}`),
              connectSocket,
            )
            return
          }

          if (options.servername || options.rejectUnauthorized !== undefined) {
            const tlsSocket = tls.connect({
              socket: connectSocket,
              servername: options.servername ?? targetHost,
              rejectUnauthorized: options.rejectUnauthorized ?? true,
            })
            callback?.(null, tlsSocket)
          } else {
            callback?.(null, connectSocket)
          }
        }
        connectSocket.on("data", onData)
      })

      return connectSocket
    }
  }

  return new ConnectProxyAgent({ keepAlive: true })
}
