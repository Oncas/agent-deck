FROM golang:1.24-alpine AS builder

# hadolint ignore=DL3018
RUN apk add --no-cache git

WORKDIR /src
ARG BUILD_COMMIT_DATE=
ARG BUILD_VERSION=
ARG GO_OS=linux
ARG GO_ARCH=amd64
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN go mod tidy && CGO_ENABLED=0 GOOS=${GO_OS} GOARCH=${GO_ARCH} go build -ldflags="-s -w -X agentdeck/internal/buildinfo.CommitDate=${BUILD_COMMIT_DATE} -X agentdeck/internal/buildinfo.Version=${BUILD_VERSION}" -o /agentdeck ./cmd/agentdeck

FROM alpine:3.21 AS build-test
# hadolint ignore=DL3018
RUN apk add --no-cache git bash
COPY --from=builder /agentdeck /agentdeck
EXPOSE 8080
ENTRYPOINT ["/agentdeck"]

FROM build-test AS build-package
