export class RepositoryNotFoundException extends Error {
  constructor(token: Function | string) {
    super(`Repository cannot be found for given token [${token}]`);
  }
}
