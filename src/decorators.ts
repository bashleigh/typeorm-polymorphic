import {
  POLYMORPHIC_KEY_SEPARATOR,
  POLYMORPHIC_OPTIONS,
  POLYMORPHIC_REPOSITORY,
} from './constants';
import {
  PolymorphicDecoratorOptionsInterface,
  PolymorphicMetadataOptionsInterface,
} from './polymorphic.interface';

const polymorphicPropertyDecorator =
  (options: PolymorphicMetadataOptionsInterface): PropertyDecorator =>
  (target: Object, propertyKey: string) => {
    Reflect.defineMetadata(POLYMORPHIC_OPTIONS, true, target);
    Reflect.defineMetadata(
      `${POLYMORPHIC_OPTIONS}${POLYMORPHIC_KEY_SEPARATOR}${propertyKey}`,
      {
        propertyKey,
        ...options,
      },
      target,
    );
  };

export const PolymorphicChildren = (
  classType: () => Function[] | Function,
  options: PolymorphicDecoratorOptionsInterface = {},
): PropertyDecorator =>
  polymorphicPropertyDecorator({
    type: 'children',
    classType,
    hasMany: true,
    eager: true,
    cascade: true,
    deleteBeforeUpdate: false,
    ...options,
  });

export const PolymorphicParent = (
  classType: () => Function[] | Function,
  options: PolymorphicDecoratorOptionsInterface = {},
): PropertyDecorator =>
  polymorphicPropertyDecorator({
    type: 'parent',
    classType,
    hasMany: false,
    eager: true,
    cascade: true,
    deleteBeforeUpdate: false,
    ...options,
  });

export const PolymorphicRepository =
  (entity: Function): ClassDecorator =>
  (target: object, _key?: any, descriptor?: any) => {
    if (descriptor) {
      Reflect.defineMetadata(POLYMORPHIC_REPOSITORY, entity, descriptor.value);
      return descriptor;
    }
    Reflect.defineMetadata(POLYMORPHIC_REPOSITORY, entity, target);
    return target;
  };
