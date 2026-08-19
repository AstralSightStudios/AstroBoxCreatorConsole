declare module "crypto-js/md5" {
  interface WordArray {
    toString(): string;
  }

  function MD5(message: string): WordArray;
  export default MD5;
}
