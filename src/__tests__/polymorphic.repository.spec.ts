import { Connection, createConnection, Repository } from 'typeorm';
import { AdvertEntity } from './entities/advert.entity';
import { UserEntity } from './entities/user.entity';
import { config } from 'dotenv';
import { resolve } from 'path';
import { AdvertRepository } from './repository/advert.repository';
import { AbstractPolymorphicRepository } from '../';

describe('AbstractPolymorphicRepository', () => {
  let connection: Connection;

  let userRepository: Repository<UserEntity>;
  let repository: AbstractPolymorphicRepository<AdvertEntity>;

  beforeAll(async () => {
    config({
      path: resolve(__dirname, '.', '..', '..', '.env'),
    });

    connection = await createConnection({
      type: 'mysql',
      host: process.env.TYPEORM_HOST,
      port: parseInt(process.env.TYPEORM_PORT, 10),
      username: process.env.TYPEORM_USERNAME,
      password: process.env.TYPEORM_PASSWORD,
      entities: ['./*/**/*.entity.ts'],
      synchronize: process.env.TYPEORM_SYNCHRONIZE === 'true',
      database: process.env.TYPEORM_DATABASE,
    });
  });

  afterAll(async () => {
    await connection.close();

    await userRepository.createQueryBuilder().delete().execute();
    await repository.createQueryBuilder().delete().execute();

    await Promise.all([
      userRepository.createQueryBuilder().delete().execute(),
      repository.createQueryBuilder().delete().execute(),
    ]);
  });

  describe('Childen', () => {
    describe('create', () => {
      it('Can create with parent', async () => {
        const repository = connection.getCustomRepository(AdvertRepository);

        const user = new UserEntity();

        const result = repository.create({
          owner: user,
        });

        expect(result).toBeInstanceOf(AdvertEntity);
        expect(result.owner).toBeInstanceOf(UserEntity);
      });
    });

    describe('save', () => {
      it('Can save cascade parent', async () => {
        const repository = connection.getCustomRepository(AdvertRepository);
        const userRepository = connection.getRepository(UserEntity);

        const user = await userRepository.save(new UserEntity());

        const result = await repository.save(
          repository.create({
            owner: user,
          }),
        );

        expect(result).toBeInstanceOf(AdvertEntity);
        expect(result.owner).toBeInstanceOf(UserEntity);
        expect(result.id).toBeTruthy();
        expect(result.owner.id).toBeTruthy();
        expect(result.entityType).toBe(UserEntity.name);
        expect(result.entityId).toBe(result.owner.id);
      });

      it('Can save many with cascade parent', async () => {
        const repository = connection.getCustomRepository(AdvertRepository);
        const userRepository = connection.getRepository(UserEntity);

        const user = await userRepository.save(new UserEntity());

        const result = await repository.save([
          repository.create({
            owner: user,
          }),
          repository.create({
            owner: user,
          }),
        ]);

        result.forEach((res) => {
          expect(res).toBeInstanceOf(AdvertEntity);
          expect(res.owner).toBeInstanceOf(UserEntity);
          expect(res.id).toBeTruthy();
          expect(res.owner.id).toBeTruthy();
          expect(res.entityType).toBe(UserEntity.name);
          expect(res.entityId).toBe(res.owner.id);
        });
      });
    });

    describe('findOne', () => {
      it('Can find entity with parent', async () => {
        const repository = connection.getCustomRepository(AdvertRepository);
        const userRepository = connection.getRepository(UserEntity);

        const user = await userRepository.save(new UserEntity());

        const advert = await repository.save(
          repository.create({
            owner: user,
          }),
        );

        const result = await repository.findOne(advert.id);

        expect(result).toBeInstanceOf(AdvertEntity);
        expect(result.owner).toBeInstanceOf(UserEntity);
        expect(result.owner.id).toBe(result.entityId);
        expect(result.entityType).toBe(UserEntity.name);
      });
    });

    describe('find', () => {
      it('Can find entities with parent', async () => {
        const repository = connection.getCustomRepository(AdvertRepository);
        const userRepository = connection.getRepository(UserEntity);

        const user = await userRepository.save(new UserEntity());

        await repository.save([
          repository.create({
            owner: user,
          }),
          repository.create({
            owner: user,
          }),
        ]);

        const result = await repository.find();

        result.forEach((res) => {
          expect(res).toBeInstanceOf(AdvertEntity);
          expect(res.owner).toBeInstanceOf(UserEntity);
          expect(res.id).toBeTruthy();
          expect(res.owner.id).toBeTruthy();
          expect(res.entityType).toBe(UserEntity.name);
          expect(res.entityId).toBe(res.owner.id);
        });
      });
    });
  });
});
