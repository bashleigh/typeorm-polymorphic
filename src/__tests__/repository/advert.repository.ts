import { PolymorphicRepository } from '../../decorators';
import { AbstractPolymorphicRepository } from '../../polymorphic.repository';
import { AdvertEntity } from '../entities/advert.entity';

@PolymorphicRepository(AdvertEntity)
export class AdvertRepository extends AbstractPolymorphicRepository<AdvertEntity> {}
