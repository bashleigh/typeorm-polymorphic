# typeorm-polymorphic
<a href="https://www.npmjs.com/package/typeorm-polymorphic"><img src="https://img.shields.io/npm/v/typeorm-polymorphic.svg"/></a>
<img src="https://github.com/bashleigh/typeorm-polymorphic/workflows/Tests/badge.svg"/>
<img src="https://camo.githubusercontent.com/a34cfbf37ba6848362bf2bee0f3915c2e38b1cc1/68747470733a2f2f696d672e736869656c64732e696f2f62616467652f5052732d77656c636f6d652d627269676874677265656e2e7376673f7374796c653d666c61742d737175617265" />
[![Coverage Status](https://coveralls.io/repos/github/bashleigh/typeorm-polymorphic/badge.svg?branch=master)](https://coveralls.io/github/bashleigh/typeorm-polymorphic?branch=master)

An extension package for polymorphic relationship management, declaration and repository queries for [typeorm](https://typeorm.io/)

> Experiemental package

## Install 

```bash
$ yarn add typeorm-polymorphic
```

> You'll also require `typeorm` and `reflect-metadata` if you haven't already installed these

This is a concept I've put together for decorated polymorphic values with typeorm. I've taken a lot of inspiration from laravel's eloquent.

This has worked for my use case however it might not for others. This is an example of how I've used it.

### Extend the PolymorphicRepository

```ts
import { PolymorphicRepository } from 'typeorm-polymorphic';

@PolymorphicRepository(AdvertEntity)
export class AdvertRepository extends AbstractPolymorphicRepository<
  AdvertEntity
> {}
```

Then, to instantiate your repository you can call:

```ts
import { AbstractPolymorphicRepository } from 'typeorm-polymorphic';

const repository = AbstractPolymorphicRepository.createRepository(
  dataSource, // where `dataSource` is a typeorm DataSource object
  AdvertRepository,
);
```

> The below decorators will only work when using the above abstract repository AbstractPolymorphicRepository

### Setup the entities

This is an example of one child, 2 parent types

#### Parents

```ts
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @PolymorphicChildren(() => AdvertEntity, {
    eager: false,
  })
  adverts: AdvertEntity[];
}
```
```ts
Entity('merchants')
export class MerchantEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @PolymorphicChildren(() => AdvertEntity, {
    eager: false,
  })
  adverts: AdvertEntity[];
}
```

#### Children

```ts
@Entity('adverts') 
export class AdvertEntity implements PolymorphicChildInterface {
  @PolymorphicParent(() => [UserEntity, MerchantEntity])
  owner: UserEntity | MerchantEntity;

  @Column()
  entityId: number;

  @Column()
  entityType: string;
}
```

#### Resulting values

This will result in the adverts table having values 

```
adverts table
==========================
id | entityId | entityType
==========================
 1 | 1        | 'UserEntity'
 2 | 1        | 'MerchantEntity'
 3 | 2        | 'UserEntity'
```

## Decorators

Both `PolymorphicChildren` and `PolymorphicParent` are treated same. Currently some of the default values are different but eventually these method should be synonyms of one another. They have different names because it helped me describe the relationship directions which could be explained as 'parent' 'child' in different ways.

`PolymorphicRepository` allows you to define a custom typeorm repository and then
instantiate it later via `AbstractPolymorphicRepository.createRepository(...)`.

### Ambiguous direction

Both `PolymorphicParent` and `PolymorphicChildren` accepts either an array of types or a singular type

```ts
@PolymorphicChildren(() => [ChildEntity, AnotherChildEntity])
@PolymorphicParent(() => [ParentEntity, AnotherParentEntity])

@PolymorphicChildren(() => ChildEntity)
@PolymorphicParent(() => ParentEntity)
```

### Options

key | what's it for? | default
---|---|---
eager | load relationships by default | true
cascade | save/delete parent/children on save/delete | true
deleteBeforeUpdate | delete relation/relations before update | false
hasMany | should return as array? | true for child. false for parent

> hasMany should really be updated so both parent and child declaration are the same. I've done to hopefully avoid confusion from the names!

## Repository Methods 

The majority of these methods overwrite the typeorm's `Repository` class methods to ensure polymorph relationships are handled before/after the parent's method.

### save

Saves the given entity and it's parent or children

extends typeorm's Repository.save method

##### Child

```ts
const repository = connection.getRepository(AdvertRepository); // That extends AbstractPolymorphicRepository

const advert = new AdvertEntity();
advert.owner = user;

await repository.save(advert);
```

##### Parent

```ts
const repository = connection.getRepository(MerchantRepository); // That extends AbstractPolymorphicRepository

const advert = new AdvertEntity();

const merchant = new MerchantEntity();
merchant.adverts = [advert];

await repository.save(merchant);
```

### find

extends typeorm's Repository.find method

```ts
const repository = connection.getRepository(MerchantRepository); // That extends AbstractPolymorphicRepository

const results = await repository.find();

// results[0].adverts === AdvertEntity[]
```
### findOne

extends typeorm's Repository.findOne method


### create

This method creates the parent or child relations for you so you don't have to manally supply an array of classes.

extends typeorm's Repository.create method

##### Child

```ts
const repository = connection.getRepository(AdvertRepository); // That extends AbstractPolymorphicRepository

const results = await repository.create({
  owner: new UserEntity(), // or MerchantEntity()
});
```

##### Parent

```ts
const repository = connection.getRepository(UserRepository); // That extends AbstractPolymorphicRepository

const results = await repository.create({
  adverts: [
    {
      name: 'test',
    },
    {
      name: 'test',
    },
  ],
});

/**
 * {
 *   adverts: [
 *     AdvertEntity{
 *       name: 'test',
 *     },
 *     AdvertEntity{
 *       name: 'test',
 *     },
 *   ],
 * }
*/
```

### hydrateMany

Hydreate one entity and get their relations to parent/child

```ts
const repository = connection.getRepository(AdvertRepository); // That extends AbstractPolymorphicRepository

const adverts = await repository.find();
// eager to parent (user|merchant) is set to false
adverts[0].owner; // undefined

await repository.hydrateMany(adverts);

adverts[0].owner; // UserEntity | MerchantEntity
```

### hydrateOne

Hydreate one entity and get their relations to parent/child

```ts
const repository = connection.getRepository(AdvertRepository); // That extends AbstractPolymorphicRepository

const advert = await repository.findOne(1);
// eager to parent (user|merchant) is set to false
advert.owner; // undefined

await repository.hydrateOne(advert);

advert.owner; // UserEntity | MerchantEntity
```

## Class-transformer

We recommend if you're working with polymorphic relationships that you use `class-transformers`'s `Transform` decorator to distinguish the different types on the frontend when returning your entities from a http call

```ts
@Entity('adverts') 
export class AdvertEntity implements PolymorphicChildInterface {
  @PolymorphicParent(() => [UserEntity, MerchantEntity])
  @Transform(
    (value: UserEntity | MerchantEntity) => ({
      ...value,
      type: value.constructor.name,
    }),
    {
      toPlainOnly: true,
    },
  )
  owner: UserEntity | MerchantEntity;

  @Column()
  entityId: number;

  @Column()
  entityType: string;
}
```

The owner property object's type property will now either be string value of `UserEntity` or `MerchantEntity`


## Possible relations 

### Singular parent, different children

This is an example of having the need of different types of children for a singular parent type

```ts
class RestaurantEntity {
  @PolymorphicChildren(() => [WaiterEntity, ChefEntity])
  staff: (WaiterEntity | ChefEntity)[];
}

class WaiterEntity implements PolymorphicChildInterface {
  @Column()
  entityId: string;

  @Column()
  entityType: string;

  @PolymorphicParent(() => RestaurantEntity)
  restaurant: RestaurantEntity;
}

class ChefEntity implements PolymorphicChildInterface {
  @Column()
  entityId: string;

  @Column()
  entityType: string;

  @PolymorphicParent(() => RestaurantEntity)
  restaurant: RestaurantEntity;
}

```

### Singular child, different parent

This is an example of having the need of a singular child shared between different types of parents

```ts
class AdvertEntity implements PolymorphicChildInterface {
  @PolymorphicParent(() => [UserEntity, MerchantEntity])
  owner: UserEntity | MerchantEntity;
}

class MerchantEntity {
  @PolymorphicChildren(() => AdvertEntity)
  adverts: AdvertEntity[];
}

class UserEntity {
  @PolymorphicChildren(() => AdvertEntity)
  adverts: AdvertEntity[];
}

```

## Notes

I think [Perf](https://github.com/Perf) might have some suggestions on how to improve things (sorry I have replied been mega busy!)

## Nestjs 

If you're using nestjs, don't forgot to include your repository into the entities array in forFeature

```ts
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdvertEntity,
      AdvertRepository,
    ]),
  ],
  providers: [AdvertService, CategoryService, TagService, AdvertPolicy],
  exports: [TypeOrmModule, AdvertService],
})
export class AdvertModule {}
```
