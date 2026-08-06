// The four calls sftp.ts makes, declared here rather than pulled in as a second dependency:
// ssh2-sftp-client ships no types, and naming the surface we depend on is also what keeps
// swapping the transport a one-file job. See ./sftp.ts and ../../docs/hunt.md.

declare module "ssh2-sftp-client" {
  export default class SftpClient {
    constructor(name?: string);
    connect(config: Record<string, unknown>): Promise<unknown>;
    get(remote: string): Promise<string | Buffer | NodeJS.WritableStream>;
    exists(remote: string): Promise<false | "d" | "-" | "l">;
    list(
      remote: string,
    ): Promise<{ name: string; type: string; size: number }[]>;
    end(): Promise<unknown>;
  }
}
