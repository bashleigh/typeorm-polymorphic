import { Entity, PrimaryGeneratedColumn } from 'typeorm';
import { PolymorphicChildren } from '../../../dist';
import { AdvertEntity } from './advert.entity';

@Entity('merchants')
export class MerchantEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @PolymorphicChildren(() => AdvertEntity, {
    eager: false,
  })
  adverts: AdvertEntity[];

  @PolymorphicChildren(() => AdvertEntity, {
    entityTypeColumn: 'creatorType',
    entityIdColumn: 'creatorId',
    eager: false,
  })
  createdAdverts: AdvertEntity[];
}
