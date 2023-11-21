import 'reflect-metadata';
import {
  DataSource,
  DeepPartial,
  FindManyOptions,
  FindOneOptions,
  getMetadataArgsStorage,
  In,
  ObjectLiteral,
  Repository,
  SaveOptions,
} from 'typeorm';
import { POLYMORPHIC_KEY_SEPARATOR, POLYMORPHIC_OPTIONS } from './constants';
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
import { POLYMORPHIC_REPOSITORY } from './constants';

type PolymorphicHydrationType = {
  key: string;
  type: 'children' | 'parent';
  hasMany: boolean;
  valueKeyMap: Record<
    string,
    (PolymorphicChildInterface | PolymorphicChildInterface[])[]
  >;
};

const entityTypeColumn = (options: PolymorphicMetadataInterface): string =>
  options.entityTypeColumn || 'entityType';
const entityIdColumn = (options: PolymorphicMetadataInterface): string =>
  options.entityTypeId || 'entityId';
const PrimaryColumn = (options: PolymorphicMetadataInterface): string =>
  options.primaryColumn || 'id';

export abstract class AbstractPolymorphicRepository<
  E extends ObjectLiteral,
> extends Repository<E> {
  public static createRepository(
    ds: DataSource,
    repository: new (...args: any[]) => any,
  ) {
    const entity = Reflect.getMetadata(POLYMORPHIC_REPOSITORY, repository);
    const baseRepository = ds.getRepository<any>(entity);
    return new repository(
      baseRepository.target,
      baseRepository.manager,
      baseRepository.queryRunner,
    );
  }

  private getPolymorphicMetadata(): Array<PolymorphicMetadataInterface> {
    const keys = Reflect.getMetadataKeys(
      (this.metadata.target as Function)['prototype'],
    );

    if (!keys) {
      return [];
    }

    return keys.reduce<Array<PolymorphicMetadataInterface>>(
      (keys: PolymorphicMetadataInterface[], key: string) => {
        if (key.split(POLYMORPHIC_KEY_SEPARATOR)[0] === POLYMORPHIC_OPTIONS) {
          const data: PolymorphicMetadataOptionsInterface & {
            propertyKey: string;
          } = Reflect.getMetadata(
            key,
            (this.metadata.target as Function)['prototype'],
          );

          if (data && typeof data === 'object') {
            const classType = data.classType();
            keys.push({
              ...data,
              classType,
            });
          }
        }

        return keys;
      },
      [],
    );
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
    const metadata = this.getPolymorphicMetadata();
    return this.hydratePolymorphs(entities, metadata);
  }

  public async hydrateOne(entity: E): Promise<E> {
    const result = await this.hydrateMany([entity]);
    return result[0];
  }

  private async hydratePolymorphs(
    entities: E[],
    options: PolymorphicMetadataInterface[],
  ): Promise<E[]> {
    const values = await Promise.all(
      options.map((option: PolymorphicMetadataInterface) =>
        this.hydrateEntities(entities, option),
      ),
    );

    const results: E[] = [];
    for (let entity of entities) {
      const result = values.reduce<E>(
        (e: E, vals: PolymorphicHydrationType) => {
          const polyKey = `${e.entityType}:${e.entityId}`;
          const polys = vals.hasMany
            ? vals.valueKeyMap[polyKey]
            : vals.valueKeyMap[polyKey][0];

          type EntityKey = keyof E;
          const key = vals.key as EntityKey;
          e[key] = polys as (typeof e)[typeof key];
          return e;
        },
        entity,
      );

      results.push(result);
    }

    return results;
  }

  private async hydrateEntities(
    entities: E[],
    options: PolymorphicMetadataInterface,
  ): Promise<PolymorphicHydrationType> {
    const typeColumn = entityTypeColumn(options);
    const entityTypes: (Function | string)[] =
      options.type === 'parent'
        ? [...new Set(entities.map((e) => e[typeColumn]))]
        : Array.isArray(options.classType)
        ? options.classType
        : [options.classType];

    // TODO if not hasMany, should I return if one is found?
    const results = await Promise.all(
      entityTypes.map((type: Function) =>
        this.findPolymorphs(entities, type, options),
      ),
    );

    const idColumn = entityIdColumn(options);
    const isParent = this.isParent(options);
    const primaryColumn = PrimaryColumn(options);

    const entitiesResultMap = results
      // flatten all the results
      .reduce<PolymorphicChildInterface[]>((acc, val) => {
        if (Array.isArray(val)) {
          acc.push(...val);
        } else {
          acc.push(val);
        }
        return acc;
      }, [])
      // map the results to a keyed map by entityType & entityId
      .reduce<
        Record<
          string,
          (PolymorphicChildInterface | PolymorphicChildInterface[])[]
        >
      >((acc, val) => {
        let key: string;
        if (isParent) {
          const [pColumnVal, entityType] = Array.isArray(val)
            ? [val[0][primaryColumn], val[0].constructor.name]
            : [val[primaryColumn], val.constructor.name];

          key = `${entityType}:${pColumnVal}`;
        } else {
          const [idColumnVal, typeColumnVal] = Array.isArray(val)
            ? [val[0][idColumn], val[0][typeColumn]]
            : [val[idColumn], val[typeColumn]];

          key = `${typeColumnVal}:${idColumnVal}`;
        }

        acc[key] = acc[key] || [];
        acc[key].push(val);
        return acc;
      }, {});
    return {
      key: options.propertyKey,
      type: options.type,
      hasMany: options.hasMany,
      valueKeyMap: entitiesResultMap,
    };
  }

  private async findPolymorphs(
    entities: E[],
    entityType: Function,
    options: PolymorphicMetadataInterface,
  ): Promise<PolymorphicChildInterface[] | PolymorphicChildInterface | never> {
    const repository = this.findRepository(entityType);
    const idColumn = entityIdColumn(options);
    const primaryColumn = PrimaryColumn(options);

    // filter out any entities that don't match the given entityType
    const filteredEntities = entities.filter((e) => {
      return repository.target.toString() === e.entityType;
    });

    const method =
      options.hasMany || filteredEntities.length > 1 ? 'find' : 'findOne';
    return repository[method](
      options.type === 'parent'
        ? {
            where: {
              // TODO: Not sure about this change (key was just id before)
              [primaryColumn]: In(filteredEntities.map((p) => p[idColumn])),
            },
          }
        : {
            where: {
              [idColumn]: In(filteredEntities.map((p) => p[primaryColumn])),
              [entityTypeColumn(options)]: entityType,
            },
          },
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
  ): Promise<(T & E) | Array<T & E> | T | Array<T>> {
    if (!this.isPolymorph()) {
      return Array.isArray(entityOrEntities)
        ? super.save(entityOrEntities, options)
        : super.save(entityOrEntities, options);
    }

    const metadata = this.getPolymorphicMetadata();

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

          /**
           * Add parent's id and type to child's id and type field
           */
          type EntityKey = keyof DeepPartial<E>;
          entity[entityIdColumn(options) as EntityKey] =
            parent[PrimaryColumn(options)];
          entity[entityTypeColumn(options) as EntityKey] =
            parent.constructor.name;
          return entity;
        });
      }
    });

    /**
     * Check deleteBeforeUpdate
     */
    Array.isArray(entityOrEntities)
      ? await Promise.all(
          (entityOrEntities as Array<T>).map((entity) =>
            this.deletePolymorphs(entity, metadata),
          ),
        )
      : await this.deletePolymorphs(entityOrEntities as T, metadata);

    return Array.isArray(entityOrEntities)
      ? super.save(entityOrEntities, options)
      : super.save(entityOrEntities, options);
  }

  private async deletePolymorphs(
    entity: DeepPartial<E>,
    options: PolymorphicMetadataInterface[],
  ): Promise<void | never> {
    await Promise.all(
      options.map(
        (option: PolymorphicMetadataInterface) =>
          new Promise((resolve) => {
            if (!option.deleteBeforeUpdate) {
              resolve(Promise.resolve());
            }

            const entityTypes = Array.isArray(option.classType)
              ? option.classType
              : [option.classType];

            // resolve to singular query?
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

  public async find(options?: FindManyOptions<E>): Promise<E[]> {
    const results = await super.find(options);

    if (!this.isPolymorph()) {
      return results;
    }

    const metadata = this.getPolymorphicMetadata();

    return this.hydratePolymorphs(results, metadata);
  }

  public async findOne(options?: FindOneOptions<E>): Promise<E | null> {
    const polymorphicMetadata = this.getPolymorphicMetadata();

    if (Object.keys(polymorphicMetadata).length === 0) {
      return super.findOne(options);
    }

    const entity = await super.findOne(options);

    if (!entity) {
      return entity;
    }

    const results = await this.hydratePolymorphs([entity], polymorphicMetadata);
    return results[0];
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

  /// TODO implement remove and have an option to delete children/parent
}
