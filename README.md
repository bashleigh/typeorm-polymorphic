# typeorm-polymorphic concept

This is a concept I've put together for decorated polymorphic values with typeorm. I've taken a lot of inspiration from laravel's eloquent.

This has worked for my use case however it might not for others. This is an example of how I've used it.

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

This will result in the adverts table having values 

```
==========================
id | entityId | entityType
==========================
 1 | 1        | 'UserEntity'
 2 | 1        | 'MerchantEntity'
 3 | 2        | 'UserEntity'
```

I think [Perf](https://github.com/Perf) might have some suggestions on how to improve things (sorry I have replied been mega busy!)

I've also used the class-transformer package so that my response objects have a different type value depending on the entityType. Could use the field tbh 

## Nestjs 

My methods work with basic hydration however the query builder needs some work. I've used a custom repository to handle all of the saving/updating/fetch. I only really use typeorm with nestjs hence I can use the repository anywhere in my project like so 
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

Where `AdvertRepository` extends the `AbstractPolymorphicRepository`

```ts
@EntityRepository(AdvertEntity)
export class AdvertRepository extends AbstractPolymorphicRepository<
  AdvertEntity
> {
...
```

Now whenever I call `advertRepository.findOne(1)` it'll also find the advert's parent (UserEntity | MerchantEntity).
Same with saving

```ts
advertRepository.save({
   owner: user,
});
```

Will automatically save the owner relationship. However this does depend on the user being an instanced UserEntity and not an object. 

## Possible use case

It is possible to have multiple types for both parent + children however I've not tested this use case.
