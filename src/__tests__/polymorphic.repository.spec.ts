import { Connection, createConnection } from 'typeorm';
import { AdvertEntity } from './entities/advert.entity';
import { UserEntity } from './entities/user.entity';
import { config } from 'dotenv';
import { resolve } from 'path';
import { AdvertRepository } from './repository/advert.repository';

describe('AbstractPolymorphicRepository', () => {
  let connection: Connection;
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
  });

  it('Can create', async () => {
    const repository = connection.getCustomRepository(AdvertRepository);

    const user = new UserEntity();

    const result = repository.create({
      owner: user,
    });

    expect(result).toBeInstanceOf(AdvertEntity);
    expect(result.owner).toBeInstanceOf(UserEntity);
  });
});
