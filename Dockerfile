# syntax=docker/dockerfile:1
# Saldo add-on image for amd64 and arm64. The web app and the Go server are
# built on the build machine and cross-compiled, so no emulation is needed.

FROM --platform=$BUILDPLATFORM node:26-alpine AS web
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS server
ARG TARGETOS TARGETARCH
ARG VERSION=dev
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
    go build -trimpath -ldflags "-s -w -X main.version=${VERSION}" -o /out/saldo ./cmd/saldo

FROM alpine:3
ARG VERSION=dev
RUN apk add --no-cache ca-certificates tzdata
COPY --from=server /out/saldo /usr/local/bin/saldo
COPY --from=web /src/web/dist /app/web

ENV SALDO_WEB_DIR=/app/web \
    SALDO_STATE_DIR=/data \
    TZ=Europe/Brussels
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["/usr/local/bin/saldo", "healthcheck"]

LABEL org.opencontainers.image.title="Saldo" \
      org.opencontainers.image.description="Self-hosted budgeting and planning for your household" \
      org.opencontainers.image.source="https://github.com/BertVanBaelen/Saldo" \
      org.opencontainers.image.version="${VERSION}" \
      io.hass.type="addon" \
      io.hass.version="${VERSION}"

ENTRYPOINT ["/usr/local/bin/saldo"]
CMD ["serve"]