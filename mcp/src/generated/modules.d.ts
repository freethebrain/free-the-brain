// Wrangler Text module rule (wrangler.toml [[rules]]): *.txt imports resolve to their string content.
declare module '*.txt' {
  const content: string;
  export default content;
}
