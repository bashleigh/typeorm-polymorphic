import { AbstractPolymorphicRepository } from '../../../dist';
import { UserEntity } from '../entities/user.entity';

export class UserRepository extends AbstractPolymorphicRepository<UserEntity> {}
