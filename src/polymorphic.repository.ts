import 'reflect-metadata';
import {
  Repository,
  getMetadataArgsStorage,
  DeepPartial,
  SaveOptions,
  FindManyOptions,
  FindOneOptions,
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

export const createPolymorphicRepository = <Entity>(
  baseRepository: Repository<Entity>,
) => {
  return {
    getPolymorphicMetadata(): Array<PolymorphicMetadataInterface> {
      const keys = Reflect.getMetadataKeys(
        baseRepository.metadata.target['prototype'],
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
              (baseRepository.metadata.target as Function)['prototype'],
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
    },
    isPolymorph(): boolean {
      return Reflect.hasOwnMetadata(
        POLYMORPHIC_OPTIONS,
        baseRepository.metadata.target['prototype'],
      );
    },
    isChildren(
      options: PolymorphicChildType | PolymorphicParentType,
    ): options is PolymorphicChildType {
      return options.type === 'children';
    },
    isParent(
      options: PolymorphicChildType | PolymorphicParentType,
    ): options is PolymorphicParentType {
      return options.type === 'parent';
    },
    async hydrateMany(entities: Entity[]): Promise<Entity[]> {
      return Promise.all(entities.map((ent) => this.hydrateOne(ent)));
    },
    async hydrateOne(entity: Entity): Promise<Entity> {
      const metadata = this.getPolymorphicMetadata();
      return this.hydratePolymorphs(entity, metadata);
    },
    async hydratePolymorphs(
      entity: Entity,
      options: PolymorphicMetadataInterface[],
    ): Promise<Entity> {
      const values = await Promise.all(
        options.map((option: PolymorphicMetadataInterface) =>
          this.hydrateEntities(entity, option),
        ),
      );

      return values.reduce<Entity>(
        (e: Entity, vals: PolymorphicHydrationType) => {
          const values =
            vals.type === 'parent' && Array.isArray(vals.values)
              ? vals.values.filter(
                  (v) => typeof v !== 'undefined' && v !== null,
                )
              : vals.values;
          e[vals.key] =
            vals.type === 'parent' && Array.isArray(values)
              ? values[0]
              : values; // TODO should be condition for !hasMany
          return e;
        },
        entity,
      );
    },
    async hydrateEntities(
      entity: Entity,
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
    },
    async findPolymorphs(
      parent: Entity,
      entityType: Function,
      options: PolymorphicMetadataInterface,
    ): Promise<
      PolymorphicChildInterface[] | PolymorphicChildInterface | never
    > {
      const repository = this.findRepository(entityType);

      return repository[options.hasMany ? 'find' : 'findOne'](
        options.type === 'parent'
          ? {
              where: {
                // TODO: Not sure about this change (key was just id before)
                [PrimaryColumn(options)]: parent[entityIdColumn(options)],
              },
            }
          : {
              where: {
                [entityIdColumn(options)]: parent[PrimaryColumn(options)],
                [entityTypeColumn(options)]: entityType,
              },
            },
      );
    },
    findRepository(
      entityType: Function,
    ): Repository<PolymorphicChildInterface | never> {
      const repositoryToken = this.resolveRepositoryToken(entityType);

      const repository: Repository<PolymorphicChildInterface> =
        repositoryToken !== entityType
          ? // TODO: Write function to resolve the custom repo for this repo
            baseRepository.manager.getCustomRepository(repositoryToken)
          : baseRepository.manager.getRepository(repositoryToken);

      if (!repository) {
        throw new RepositoryNotFoundException(repositoryToken);
      }

      return repository;
    },
    resolveRepositoryToken(token: Function): Function | never {
      const tokens = getMetadataArgsStorage().entityRepositories.filter(
        (value: EntityRepositoryMetadataArgs) => value.entity === token,
      );
      return tokens[0] ? tokens[0].target : token;
    },
    async save<T extends DeepPartial<Entity>>(
      entityOrEntities: T | Array<T>,
      options?: SaveOptions & { reload: false },
    ): Promise<(T & Entity) | Array<T & Entity> | T | Array<T>> {
      if (!this.isPolymorph()) {
        return Array.isArray(entityOrEntities)
          ? baseRepository.save(entityOrEntities, options)
          : baseRepository.save(entityOrEntities, options);
      }

      const metadata = this.getPolymorphicMetadata();

      metadata.map((options: PolymorphicOptionsType) => {
        if (this.isParent(options)) {
          (Array.isArray(entityOrEntities)
            ? entityOrEntities
            : [entityOrEntities]
          ).map((entity: Entity | DeepPartial<Entity>) => {
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
        ? baseRepository.save(entityOrEntities, options)
        : baseRepository.save(entityOrEntities, options);
    },
    async deletePolymorphs(
      entity: DeepPartial<Entity>,
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
    },
    async find(options?: FindManyOptions<Entity>): Promise<Entity[]> {
      const results = await baseRepository.find(options);

      if (!this.isPolymorph()) {
        return results;
      }

      const metadata = this.getPolymorphicMetadata();

      return Promise.all(
        results.map((entity) => this.hydratePolymorphs(entity, metadata)),
      );
    },
    async findOne(
      options?: FindOneOptions<Entity>,
    ): Promise<Entity | undefined> {
      const polymorphicMetadata = this.getPolymorphicMetadata();

      if (Object.keys(polymorphicMetadata).length === 0) {
        return baseRepository.findOne(options);
      }

      const entity = await baseRepository.findOne(options);

      if (!entity) {
        return entity;
      }

      return this.hydratePolymorphs(entity, polymorphicMetadata);
    },
    create(
      plainEntityLikeOrPlainEntityLikes?:
        | DeepPartial<Entity>
        | DeepPartial<Entity>[],
    ): Entity | Entity[] {
      const metadata = this.getPolymorphicMetadata();
      const entity = baseRepository.create(
        plainEntityLikeOrPlainEntityLikes as any,
      );
      if (!metadata) {
        return entity;
      }
      metadata.forEach((value: PolymorphicOptionsType) => {
        entity[value.propertyKey] =
          plainEntityLikeOrPlainEntityLikes[value.propertyKey];
      });
      return entity;
    },
    // TODO implement remove and have an option to delete children/parent
  } as ThisType<Repository<Entity>>;
};
