// e2e không bao giờ spawn process thật: thay execa bằng stub.
export const execa = (): Promise<never> =>
  Promise.reject(new Error('execa is disabled in e2e tests'));
