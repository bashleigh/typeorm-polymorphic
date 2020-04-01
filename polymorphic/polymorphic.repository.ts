import {
  Repository,
  getMetadataArgsStorage,
  DeepPartial,
  SaveOptions,
  FindConditions,
  FindManyOptions,
  FindOneOptions,
  ObjectID,
} from 'typeorm';
import { POLYMORPHIC_OPTIONS } from './contstants';
import {
  PolymorphicChildType,
  PolymorphicParentType,
  PolymorphicChildInterface,
  PolymorphicOptionsType,
  PolymorphicMetadataInterface,
  PolymorphicMetadataOptionsInterface,
} from './polymorphic.interface';
import { EntityRepositoryMetadataArgs } from 'typeorm/metadata-args/EntityRepositoryMetadataArgs';
import { RepositoryNotFoundException } from './repository.token.exception';

type PolymorphicHydrationType = {
  key: string;
  type: 'children' | 'parent';
  values: PolymorphicChildInterface[] | PolymorphicChildInterface;
};

const entityTypeColumn = (options: PolymorphicMetadataInterface): string =>
  options.entityTypeColumn || 'entityType';
const entityIdColumn = (options: PolymorphicMetadataInterface): string =>
  options.entityTypeId || 'entityId';
const PrimaryColumn = (options: PolymorphicMetadataInterface): string =>
  options.primaryColumn || 'id';

export abstract class AbstractPolymorphicRepository<E> extends Repository<E> {
  private getPolymorphicMetadata(): Array<PolymorphicMetadataInterface> {
    let keys = Reflect.getMetadataKeys(
      (this.metadata.target as Function)['prototype'],
    );

    if (!Array.isArray(keys)) {
      return [];
    }

    keys = keys.filter((key: string) => {
      const parts = key.split('::');
      return parts[0] === POLYMORPHIC_OPTIONS;
    });

    if (!keys) {
      return [];
    }

    return keys
      .map(
        (key: string): PolymorphicMetadataInterface | undefined => {
          const data: PolymorphicMetadataOptionsInterface & {
            propertyKey: string;
          } = Reflect.getMetadata(
            key,
            (this.metadata.target as Function)['prototype'],
          );

          if (typeof data === 'object') {
            const classType = data.classType();
            return {
              ...data,
              classType,
            };
          }
        },
      )
      .filter(val => typeof val !== 'undefined');
  }

  protected isPolymorph(): boolean {
    return Reflect.hasOwnMetadata(
      POLYMORPHIC_OPTIONS,
      (this.metadata.target as Function)['prototype'],
    );
  }

  protected isChildren(
    options: PolymorphicChildType | PolymorphicParentType,
  ): options is PolymorphicChildType {
    return options.type === 'children';
  }

  protected isParent(
    options: PolymorphicChildType | PolymorphicParentType,
  ): options is PolymorphicParentType {
    return options.type === 'parent';
  }

  public async hydrateMany(entities: E[]): Promise<E[]> {
    return Promise.all(entities.map(ent => this.hydrateOne(ent)));
  }

  public async hydrateOne(entity: E): Promise<E> {
    const metadata = this.getPolymorphicMetadata();

    return this.hydratePolymorphs(entity, metadata);
  }

  private async hydratePolymorphs(
    entity: E,
    options: PolymorphicMetadataInterface[],
  ): Promise<E> {
    const values = await Promise.all(
      options.map((option: PolymorphicMetadataInterface) =>
        this.hydrateEntities(entity, option),
      ),
    );

    return values.reduce<E>((e: E, vals: PolymorphicHydrationType) => {
      const values =
        vals.type === 'parent' && Array.isArray(vals.values)
          ? vals.values.filter(v => typeof v !== 'undefined' && v !== null)
          : vals.values;
      e[vals.key] =
        vals.type === 'parent' && Array.isArray(values) ? values[0] : values; // TODO should be condition for !hasMany
      return e;
    }, entity);
  }

  private async hydrateEntities(
    entity: E,
    options: PolymorphicMetadataInterface,
  ): Promise<PolymorphicHydrationType> {
    const entityTypes: (Function | string)[] = Array.isArray(options.classType)
      ? options.classType
      : [options.classType];

    // TODO if not hasMany, should I return if one is found?
    const results = await Promise.all(
      entityTypes.map((type: Function) =>
        this.findPolymorphs(entity, type, options),
      ),
    );

    return {
      key: options.propertyKey,
      type: options.type,
      values: (options.hasMany &&
      Array.isArray(results) &&
      results.length > 0 &&
      Array.isArray(results[0])
        ? results.reduce<PolymorphicChildInterface[]>(
            (
              resultEntities: PolymorphicChildInterface[],
              entities: PolymorphicChildInterface[],
            ) => entities.concat(...resultEntities),
            results as PolymorphicChildInterface[],
          )
        : results) as PolymorphicChildInterface | PolymorphicChildInterface[],
    };
  }

  private async findPolymorphs(
    parent: E,
    entityType: Function,
    options: PolymorphicMetadataInterface,
  ): Promise<PolymorphicChildInterface[] | PolymorphicChildInterface | never> {
    const repository = this.findRepository(entityType);

    return repository[options.hasMany ? 'find' : 'findOne']({
      where: {
        [entityIdColumn(options)]: parent[PrimaryColumn(options)],
        [entityTypeColumn(options)]: entityType,
      },
    });
  }

  private async savePolymorhic(
    entity: E,
    options: PolymorphicMetadataInterface,
  ): Promise<PolymorphicChildInterface[] | PolymorphicChildInterface> {
    const entities:
      | PolymorphicChildInterface
      | PolymorphicChildInterface[]
      | undefined = entity[options.propertyKey];

    if (!entities) {
      return undefined;
    }

    if (Array.isArray(entities)) {
      return Promise.all(
        entities.map(polymorph => {
          polymorph[entityIdColumn(options)] = entity[entityIdColumn(options)];
          polymorph[entityTypeColumn(options)] = this.metadata.targetName;

          return this.manager.save(polymorph);
        }),
      );
    } else {
      entities[entityIdColumn(options)] = entity[entityIdColumn(options)];
      entities[entityTypeColumn(options)] = this.metadata.targetName;
      return this.manager.save(entities);
    }
  }

  private async savePolymorphs(
    entity: E,
    options: PolymorphicMetadataInterface[],
  ): Promise<E> {
    const results = await Promise.all(
      options.map(
        (options: PolymorphicMetadataInterface) =>
          new Promise(async resolve =>
            options.cascade
              ? resolve({
                  key: options.propertyKey,
                  entities: await this.savePolymorhic(entity, options),
                })
              : resolve(undefined),
          ),
      ),
    );

    results.forEach(
      (
        result:
          | { key: string; entities: PolymorphicChildInterface[] }
          | undefined,
      ) => {
        if (!result) {
          return;
        }
        entity[result.key] = result.entities;
      },
    );

    return entity;
  }

  private async deletePolymorphs(
    entity: E,
    options: PolymorphicMetadataInterface[],
  ): Promise<void | never> {
    await Promise.all(
      options.map(
        (option: PolymorphicMetadataInterface) =>
          new Promise(resolve => {
            if (!option.deleteBeforeUpdate) {
              return Promise.resolve();
            }

            const entityTypes = Array.isArray(option.classType)
              ? option.classType
              : [option.classType];

            resolve(
              Promise.all(
                entityTypes.map((type: () => Function | Function[]) => {
                  const repository = this.findRepository(type);

                  repository.delete({
                    [entityTypeColumn(option)]: type,
                    [entityIdColumn(option)]: entity[PrimaryColumn(option)],
                  });
                }),
              ),
            );
          }),
      ),
    );
  }

  private findRepository(
    entityType: Function,
  ): Repository<PolymorphicChildInterface | never> {
    const repositoryToken = this.resolveRepositoryToken(entityType);

    const repository: Repository<PolymorphicChildInterface> =
      repositoryToken !== entityType
        ? this.manager.getCustomRepository(repositoryToken)
        : this.manager.getRepository(repositoryToken);

    if (!repository) {
      throw new RepositoryNotFoundException(repositoryToken);
    }

    return repository;
  }

  private resolveRepositoryToken(token: Function): Function | never {
    const tokens = getMetadataArgsStorage().entityRepositories.filter(
      (value: EntityRepositoryMetadataArgs) => value.entity === token,
    );
    return tokens[0] ? tokens[0].target : token;
  }

  save<T extends DeepPartial<E>>(
    entities: T[],
    options: SaveOptions & {
      reload: false;
    },
  ): Promise<T[]>;

  save<T extends DeepPartial<E>>(
    entities: T[],
    options?: SaveOptions,
  ): Promise<(T & E)[]>;

  save<T extends DeepPartial<E>>(
    entity: T,
    options?: SaveOptions & {
      reload: false;
    },
  ): Promise<T>;

  public async save<T extends DeepPartial<E>>(
    entityOrEntities: T | Array<T>,
    options?: SaveOptions & { reload: false },
  ): Promise<T & E | Array<T & E> | T | Array<T>> {
    if (!this.isPolymorph()) {
      return Array.isArray(entityOrEntities) && options
        ? await super.save(entityOrEntities, options)
        : Array.isArray(entityOrEntities)
        ? await super.save(entityOrEntities)
        : options
        ? await super.save(entityOrEntities, options)
        : await super.save(entityOrEntities);
    }

    const metadata = this.getPolymorphicMetadata();

    // TODO find if it has a parent metadata
    // TODO set the columns

    metadata.map((options: PolymorphicOptionsType) => {
      if (this.isParent(options)) {
        (Array.isArray(entityOrEntities)
          ? entityOrEntities
          : [entityOrEntities]
        ).map((entity: E | DeepPartial<E>) => {
          const parent = entity[options.propertyKey];

          if (!parent || entity[entityIdColumn(options)] !== undefined) {
            return entity;
          }
          entity[entityIdColumn(options)] = parent[PrimaryColumn(options)];
          entity[entityTypeColumn(options)] = parent.constructor.name;
          return entity;
        });
      }
    });

    const savedEntities =
      Array.isArray(entityOrEntities) && options
        ? await super.save(entityOrEntities, options)
        : Array.isArray(entityOrEntities)
        ? await super.save(entityOrEntities)
        : options
        ? await super.save(entityOrEntities, options)
        : await super.save(entityOrEntities);

    return savedEntities;

    // return Promise.all(
    //   (Array.isArray(savedEntities) ? savedEntities : [savedEntities]).map(
    //     entity =>
    //       new Promise(async resolve => {
    //         // @ts-ignore
    //         await this.deletePolymorphs(entity as E, metadata);
    //         // @ts-ignore
    //         resolve(await this.savePolymorphs(entity as E, metadata));
    //       }),
    //   ),
    // );
  }

  find(options?: FindManyOptions<E>): Promise<E[]>;

  find(conditions?: FindConditions<E>): Promise<E[]>;

  public async find(
    optionsOrConditions?: FindConditions<E> | FindManyOptions<E>,
  ): Promise<E[]> {
    console.log('called');
    const results = await super.find(optionsOrConditions);

    if (!this.isPolymorph()) {
      return results;
    }

    const metadata = this.getPolymorphicMetadata();

    return Promise.all(
      results.map(entity => this.hydratePolymorphs(entity, metadata)),
    );
  }

  findOne(
    id?: string | number | Date | ObjectID,
    options?: FindOneOptions<E>,
  ): Promise<E | undefined>;

  findOne(options?: FindOneOptions<E>): Promise<E | undefined>;

  findOne(
    conditions?: FindConditions<E>,
    options?: FindOneOptions<E>,
  ): Promise<E | undefined>;

  public async findOne(
    idOrOptionsOrConditions?:
      | string
      | number
      | Date
      | ObjectID
      | FindConditions<E>
      | FindOneOptions<E>,
    optionsOrConditions?: FindConditions<E> | FindOneOptions<E>,
  ): Promise<E | undefined> {
    const polymorphicMetadata = this.getPolymorphicMetadata();

    if (Object.keys(polymorphicMetadata).length === 0) {
      return idOrOptionsOrConditions &&
        (typeof idOrOptionsOrConditions === 'string' ||
          typeof idOrOptionsOrConditions === 'number' ||
          typeof idOrOptionsOrConditions === 'object') &&
        optionsOrConditions
        ? super.findOne(
            idOrOptionsOrConditions as number | string | ObjectID | Date,
            optionsOrConditions as FindConditions<E> | FindOneOptions<E>,
          )
        : super.findOne(idOrOptionsOrConditions as
            | FindConditions<E>
            | FindOneOptions<E>);
    }

    const entity =
      idOrOptionsOrConditions &&
      (typeof idOrOptionsOrConditions === 'string' ||
        typeof idOrOptionsOrConditions === 'number' ||
        typeof idOrOptionsOrConditions === 'object') &&
      optionsOrConditions
        ? await super.findOne(
            idOrOptionsOrConditions as number | string | ObjectID | Date,
            optionsOrConditions as FindConditions<E> | FindOneOptions<E>,
          )
        : await super.findOne(idOrOptionsOrConditions as
            | FindConditions<E>
            | FindOneOptions<E>);

    if (!entity) {
      return entity;
    }

    return await this.hydratePolymorphs(entity, polymorphicMetadata);
  }

  create(): E;

  create(entityLikeArray: DeepPartial<E>[]): E[];

  create(entityLike: DeepPartial<E>): E;

  create(
    plainEntityLikeOrPlainEntityLikes?: DeepPartial<E> | DeepPartial<E>[],
  ): E | E[] {
    const metadata = this.getPolymorphicMetadata();
    const entity = super.create(plainEntityLikeOrPlainEntityLikes as any);
    if (!metadata) {
      return entity;
    }
    metadata.forEach((value: PolymorphicOptionsType) => {
      entity[value.propertyKey] =
        plainEntityLikeOrPlainEntityLikes[value.propertyKey];
    });

    return entity;
  }

  // TODO add save, update etc

  /// TODO implement remove and have an option to delete children/parent

  // TODO implement method to prevent hydrating parent search to stop circular
}
