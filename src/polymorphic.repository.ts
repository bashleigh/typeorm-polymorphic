import 'reflect-metadata';
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
    return Promise.all(entities.map((ent) => this.hydrateOne(ent)));
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
          ? vals.values.filter((v) => typeof v !== 'undefined' && v !== null)
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
    const entityTypes: (Function | string)[] =
      options.type === 'parent'
        ? [entity[entityTypeColumn(options)]]
        : Array.isArray(options.classType)
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

    return repository[options.hasMany ? 'find' : 'findOne'](
      options.type === 'parent'
        ? {
            where: {
              id: parent[entityIdColumn(options)],
            },
          }
        : {
            where: {
              [entityIdColumn(options)]: parent[PrimaryColumn(options)],
              [entityTypeColumn(options)]: parent.constructor.name,
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
          entity[entityIdColumn(options)] = parent[PrimaryColumn(options)];
          entity[entityTypeColumn(options)] = parent.constructor.name;
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

  find(options?: FindManyOptions<E>): Promise<E[]>;

  find(conditions?: FindConditions<E>): Promise<E[]>;

  public async find(
    optionsOrConditions?: FindConditions<E> | FindManyOptions<E>,
  ): Promise<E[]> {
    const results = await super.find(optionsOrConditions);

    if (!this.isPolymorph()) {
      return results;
    }

    const metadata = this.getPolymorphicMetadata();

    return Promise.all(
      results.map((entity) => this.hydratePolymorphs(entity, metadata)),
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
        : super.findOne(
            idOrOptionsOrConditions as FindConditions<E> | FindOneOptions<E>,
          );
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
        : await super.findOne(
            idOrOptionsOrConditions as FindConditions<E> | FindOneOptions<E>,
          );

    if (!entity) {
      return entity;
    }

    return this.hydratePolymorphs(entity, polymorphicMetadata);
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
