FROM rust:1.52 as builder
WORKDIR /usr/src/app
COPY . .
RUN cargo install --path .

FROM alpine:3.14.1
COPY --from=builder /usr/local/cargo/bin/gh-updater /usr/local/bin/gh-updater
CMD ["gh-updater"]