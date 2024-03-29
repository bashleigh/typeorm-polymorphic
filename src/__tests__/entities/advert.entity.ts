import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { PolymorphicParent } from '../../../dist';
import { MerchantEntity } from './merchant.entity';
import { UserEntity } from './user.entity';

@Entity('adverts')
export class AdvertEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @PolymorphicParent(() => [UserEntity, MerchantEntity], {
    eager: true,
  })
  owner: UserEntity | MerchantEntity;

  @Column({ nullable: true })
  entityId: number;

  @Column({ nullable: true })
  entityType: string;
}
