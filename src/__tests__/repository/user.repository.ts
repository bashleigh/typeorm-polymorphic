import { AbstractPolymorphicRepository } from '../../../dist';
import { PolymorphicRepository } from '../../decorators';
import { UserEntity } from '../entities/user.entity';

@PolymorphicRepository(UserEntity)
export class UserRepository extends AbstractPolymorphicRepository<UserEntity> {}
