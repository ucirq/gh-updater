FROM rust:1.52 as builder
WORKDIR /usr/src/app
COPY . .
RUN cargo install -q --path .

FROM debian:buster-slim
RUN apt-get update -q && apt-get install -q -y pkg-config libssl-dev ca-certificates
COPY --from=builder /usr/local/cargo/bin/gh-updater /usr/local/bin/gh-updater
CMD ["gh-updater"]
