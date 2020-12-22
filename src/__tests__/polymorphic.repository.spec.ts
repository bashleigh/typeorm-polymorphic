import { Connection, createConnection, Repository } from 'typeorm';
import { AdvertEntity } from './entities/advert.entity';
import { UserEntity } from './entities/user.entity';
import { config } from 'dotenv';
import { resolve } from 'path';
import { AdvertRepository } from './repository/advert.repository';
import { AbstractPolymorphicRepository } from '../../dist';

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

  describe("child", () => {
    it('Can create with parent', async () => {
      const repository = connection.getCustomRepository(AdvertRepository);
  
      const user = new UserEntity();
  
      const result = repository.create({
        owner: user,
      });
  
      expect(result).toBeInstanceOf(AdvertEntity);
      expect(result.owner).toBeInstanceOf(UserEntity);
    });

    it('Can save cascade parent', async () => {
      const repository = connection.getCustomRepository(AdvertRepository);
      const userRepository = connection.getRepository(UserEntity);
  
      const user = await userRepository.save(new UserEntity);
  
      const result = await repository.save(repository.create({
        owner: user,
      }));
  
      expect(result).toBeInstanceOf(AdvertEntity);
      expect(result.owner).toBeInstanceOf(UserEntity);
      expect(result.id).toBeTruthy();
      expect(result.owner.id).toBeTruthy();
      expect(result.entityType).toBe(UserEntity.name);
      expect(result.entityId).toBe(result.owner.id);
    });
  });
});
