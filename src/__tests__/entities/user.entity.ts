import { Entity, PrimaryGeneratedColumn } from 'typeorm';
import { PolymorphicChildren } from '../../../dist';
import { AdvertEntity } from './advert.entity';

@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @PolymorphicChildren(() => AdvertEntity, {
    eager: false,
  })
  adverts: AdvertEntity[];
}
