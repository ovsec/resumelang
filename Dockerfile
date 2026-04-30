# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build -o resumelang .

# Runtime stage
FROM alpine:3.19

RUN apk --no-cache add ca-certificates

WORKDIR /app

COPY --from=builder /app/resumelang .
COPY web/ ./web/
COPY schema/ ./schema/
COPY themes/ ./themes/
COPY templates/ ./templates/

ENV PORT=8080
EXPOSE 8080

CMD ["./resumelang", "serve", "--port", "8080"]