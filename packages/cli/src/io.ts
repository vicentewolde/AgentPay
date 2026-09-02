/**
 * The CLI's output seam. Real usage writes to the process streams; tests
 * inject a capturing implementation instead of spawning a subprocess.
 */
export interface CliIO {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

export const PROCESS_IO: CliIO = {
  stdout: (text) => {
    process.stdout.write(text);
  },
  stderr: (text) => {
    process.stderr.write(text);
  },
};
