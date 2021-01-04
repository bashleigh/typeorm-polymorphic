export class RepositoryTokenNotFoundException extends Error {
  constructor(classType: string) {
    super(
      `Repository token cannot be found for given classType [${classType}]`,
    );
  }
}

export class RepositoryNotFoundException extends Error {
  constructor(token: Function | string) {
    super(`Repository cannot be found for given token [${token}]`);
  }
}
