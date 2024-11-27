import { Entity, PrimaryGeneratedColumn } from 'typeorm';
import { PolymorphicChildren } from '../../../dist';
import { AdvertEntity } from './advert.entity';

@Entity('admins')
export class AdminEntity {
    @PrimaryGeneratedColumn()
    admin_id: number;

    @PolymorphicChildren(() => AdvertEntity, {
        eager: false,
        primaryColumn: "admin_id"
    })
    adverts: AdvertEntity[];
}
