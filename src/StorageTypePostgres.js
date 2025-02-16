import {
  StorageType,
  DataTypeID,
  DataTypeInteger,
  DataTypeBigInt,
  DataTypeFloat,
  DataTypeBoolean,
  DataTypeString,
  DataTypeJson,
  DataTypeTimestamp,
  DataTypeTimestampTz,
  DataTypeDate,
  DataTypeTime,
  DataTypeTimeTz,
  DataTypeUUID,
  DataTypeI18n,
  isDataTypeEnum,
  isDataTypeState,
  isObjectDataType,
  isListDataType,
  sortDataByKeys,
  processCursors,
  MUTATION_TYPE_CREATE,
  MUTATION_TYPE_UPDATE,
  MUTATION_TYPE_DELETE,
  CustomError,
  deleteUndefinedProps,
  isArray,
  isMap,
} from 'shyft';

import {
  StorageDataTypeInteger,
  StorageDataTypeBigInt,
  StorageDataTypeNumeric,
  StorageDataTypeBoolean,
  StorageDataTypeText,
  StorageDataTypeJSON,
  StorageDataTypeTimestamp,
  StorageDataTypeTimestampTz,
  StorageDataTypeDate,
  StorageDataTypeTime,
  StorageDataTypeTimeTz,
  StorageDataTypeUUID,
  StorageDataTypeI18n,
} from './storageDataTypes';

import Dataloader from 'dataloader';

import { invertDirection, getLimit, quote } from './util';

import { processAndConvertFilter, buildWhereQuery } from './filter';

import {
  PERMISSION_TYPES,
  handlePermission,
  applyPermission,
} from './permission';

import { parseValues, parseValuesMap, serializeValues } from './helpers';

import { i18nTransformFilterAttributeName } from './i18n';

const processOrmError = (err, storageInstance, qBuilder, constraints) => {
  if (String(err.code) === '23505') {
    let meta;

    if (constraints) {
      const constraintName = err.constraint;
      if (constraintName) {
        meta = constraints.unique[constraintName];
      }
    }

    throw new CustomError(
      'Uniqueness constraint violated',
      'UniqueConstraintError',
      null,
      meta,
    );
  } else if (String(err.code) === '23503') {
    throw new CustomError('Foreign key not found', 'ForeignKeyConstraintError');
  } else if (String(err.code) === '22P02') {
    throw new CustomError(err.message, 'InvalidInputSyntaxError');
  } else if (String(err.code) === '23502') {
    throw new CustomError(err.message, 'NotNullConstraintViolationError');
  } else if (String(err.code) === '42703') {
    throw new CustomError(err.message, 'UndefinedColumnError');
  }

  storageInstance.logger.logQueryError(err.message, qBuilder.getSql());
  throw new CustomError('Undefined server error', 'UndefinedServerError', 500);
};

export const transformFilterAttributeName = (context, entity, modelRegistry) =>
  i18nTransformFilterAttributeName(context, entity, modelRegistry);

const createDataLoader = (context, entity, StorageTypePostgres) => {
  const storageInstance = StorageTypePostgres.getStorageInstance();
  const modelRegistry = StorageTypePostgres.getStorageModels();
  const manager = storageInstance.manager;

  const loader = new Dataloader(async ids => {
    const entityName = entity.name;
    const { filterShaper, storageTableName } = modelRegistry[entityName];
    const { name: primaryAttributeName } = entity.getPrimaryAttribute();

    let permissionWhere = await handlePermission(
      context,
      entity,
      PERMISSION_TYPES.read,
    );
    if (permissionWhere) {
      permissionWhere = filterShaper(permissionWhere);
    }

    const baseWhere = {
      $and: [],
    };

    if (ids.length === 1) {
      baseWhere.$and.push({
        [primaryAttributeName]: ids[0],
      });
    } else {
      baseWhere.$and.push({
        [primaryAttributeName]: {
          $in: ids,
        },
      });
    }

    const where = applyPermission(baseWhere, permissionWhere);

    const qBuilder = manager.createQueryBuilder(
      storageTableName,
      storageTableName,
    );
    buildWhereQuery(qBuilder, where, entityName, modelRegistry, true);

    try {
      const rows = await qBuilder.getMany();
      const data = parseValuesMap(
        entity,
        rows,
        modelRegistry[entityName],
        context,
      );

      // reorder results to match requested IDs order
      // https://github.com/facebook/dataloader/issues/66
      return sortDataByKeys(ids, data, primaryAttributeName);
    } catch (err) {
      processOrmError(err, storageInstance, qBuilder);
    }

    return null;
  });

  return loader;
};

const buildInstanceNotFoundError = id => {
  return new CustomError(
    `Instance with ID '${id}' not found`,
    'InstanceNotFound',
  );
};

const buildInstanceNotFoundOrAccessDeniedError = id => {
  return new CustomError(
    `Instance with ID '${id}' not found or access denied`,
    'InstanceNotFoundOrAccessDenied',
  );
};

const buildMutationDeniedError = mutationName => {
  return new CustomError(
    `Mutation '${mutationName}' denied`,
    'PermissionError',
    403,
  );
};

export const preMutationPermissionCheckQueryGenerator = (
  StorageTypePostgres,
  permissionWhere,
  entityName,
  modelRegistry,
) => {
  const storageInstance = StorageTypePostgres.getStorageInstance();
  const manager = storageInstance.manager;

  const qBuilder = manager
    .createQueryBuilder()
    .select()
    .from('');

  buildWhereQuery(qBuilder, permissionWhere, entityName, modelRegistry);

  const [query, queryParams] = qBuilder.getQueryAndParameters();

  return [query.replace(/ \* FROM  WHERE /, ' ') + ' AS found', queryParams];
};

export const extendWithFromStateCheck = (where, entity, entityMutation) => {
  const { fromState } = entityMutation;
  const states = entity.getStates();

  if (!fromState || !states) {
    return;
  }

  const fromStates = isArray(fromState) ? fromState : [fromState];

  const stateIds = fromStates.map(stateName => {
    return states[stateName];
  });

  where.$and.push({
    state: {
      $in: stateIds,
    },
  });
};

export const StorageTypePostgres = new StorageType({
  name: 'StorageTypePostgres',
  description: 'Postgres database storage type',

  findOne(entity, id, args, context) {
    const entityName = entity.name;
    context.loaders = context.loaders || {};
    const loaders = context.loaders;
    let loader = loaders[entityName];

    if (!loader) {
      loader = loaders[entityName] = createDataLoader(context, entity, this);
    }

    return loader.load(id);
  },

  async findOneByValues(entity, args, context) {
    const storageInstance = this.getStorageInstance();
    const manager = storageInstance.manager;
    const modelRegistry = this.getStorageModels();

    const entityName = entity.name;
    context.loaders = context.loaders || {};
    const loaders = context.loaders;
    let loader = loaders[entityName];

    const { filterShaper, storageTableName } = modelRegistry[entityName];
    const { name: primaryAttributeName } = entity.getPrimaryAttribute();

    if (!loader) {
      loader = loaders[entityName] = createDataLoader(context, entity, this);
    }

    let permissionWhere = await handlePermission(
      context,
      entity,
      PERMISSION_TYPES.find,
    );
    if (permissionWhere) {
      permissionWhere = filterShaper(permissionWhere);
    }

    const baseWhere = {
      $and: [args],
    };

    const where = applyPermission(baseWhere, permissionWhere);

    const qBuilder = manager.createQueryBuilder(
      storageTableName,
      storageTableName,
    );
    const transformFn = transformFilterAttributeName(
      context,
      entity,
      modelRegistry,
    );
    buildWhereQuery(
      qBuilder,
      where,
      entityName,
      modelRegistry,
      false,
      transformFn,
    );

    let result;

    try {
      result = await qBuilder.getOne();
    } catch (err) {
      processOrmError(err, storageInstance, qBuilder);
    }

    if (result) {
      loader.prime(result[primaryAttributeName], result);
    }

    return parseValues(entity, result, modelRegistry[entityName], context);
  },

  async find(entity, args, context, parentConnection) {
    const storageInstance = this.getStorageInstance();
    const manager = storageInstance.manager;
    const modelRegistry = this.getStorageModels();

    const entityName = entity.name;
    const { dataShaperMap, filterShaper, storageTableName } = modelRegistry[
      entityName
    ];

    let primaryAttributeName;
    if (entity.getPrimaryAttribute()) {
      primaryAttributeName = entity.getPrimaryAttribute().name;
    }

    context.loaders = context.loaders || {};
    const loaders = context.loaders;
    let loader = loaders[entityName];

    const reverseOrder = !!args.last;

    let permissionWhere;

    if (!args.skipPermissions) {
      permissionWhere = await handlePermission(
        context,
        entity,
        PERMISSION_TYPES.find,
      );

      if (permissionWhere) {
        permissionWhere = filterShaper(permissionWhere);
      }
    }

    const pageInfo = {
      hasNextPage: false,
      hasPreviousPage: false,
    };

    let limit = null;

    if (!args.all) {
      limit = getLimit(args.first, args.last);

      if (limit === 0) {
        // no point in fetching data
        return {
          data: [],
          pageInfo,
        };
      }

      limit += 1; // ask for 1 more to determine if there is a next page
    }

    const offset = args.offset;

    const baseWhere = {
      $and: [
        {
          ...processAndConvertFilter(entity, filterShaper, args, this),
        },
        {
          ...processCursors(entity, args),
        },
      ],
    };

    const where = args.skipPermissions
      ? baseWhere
      : applyPermission(baseWhere, permissionWhere);

    if (parentConnection) {
      where.$and.push({
        [parentConnection.attribute]: parentConnection.id,
      });
    }

    const qBuilder = manager
      .createQueryBuilder(storageTableName, storageTableName)
      .offset(offset);

    if (limit) {
      qBuilder.limit(limit);
    }

    if (args.orderBy) {
      args.orderBy.map(({ attribute, direction }) => {
        if (!dataShaperMap[attribute]) {
          throw new CustomError(
            `Unknown sorting attribute: ${attribute}`,
            'UnknownSortingAttributeError',
          );
        }

        qBuilder.addOrderBy(
          quote(dataShaperMap[attribute]),
          reverseOrder ? invertDirection(direction) : direction,
        );
      });
    }

    const transformFn = transformFilterAttributeName(
      context,
      entity,
      modelRegistry,
    );
    buildWhereQuery(
      qBuilder,
      where,
      entityName,
      modelRegistry,
      true,
      transformFn,
    );

    let result;

    try {
      result = await qBuilder.getMany();
    } catch (err) {
      processOrmError(err, storageInstance, qBuilder);
    }

    if (entity.getPrimaryAttribute()) {
      if (!loader) {
        loader = loaders[entityName] = createDataLoader(context, entity, this);
      }

      result.map(row => {
        loader.prime(row[primaryAttributeName], row);
      });
    }

    if (limit) {
      // remove the 1 extra row if it exists
      if (result.length >= limit) {
        result = result.slice(0, limit - 1);

        if (reverseOrder) {
          pageInfo.hasPreviousPage = true;
        } else {
          pageInfo.hasNextPage = true;
        }
      }
    }

    const orderedResults = reverseOrder ? result.reverse() : result;

    const data = parseValuesMap(
      entity,
      orderedResults,
      modelRegistry[entityName],
      context,
    );

    return {
      data,
      pageInfo,
    };
  },

  async count(entity, args, context, parentConnection) {
    const storageInstance = this.getStorageInstance();
    const manager = storageInstance.manager;
    const modelRegistry = this.getStorageModels();

    const entityName = entity.name;
    const { filterShaper, storageTableName } = modelRegistry[entityName];

    let permissionWhere = await handlePermission(
      context,
      entity,
      PERMISSION_TYPES.find,
    );
    if (permissionWhere) {
      permissionWhere = filterShaper(permissionWhere);
    }

    const baseWhere = {
      $and: [
        {
          ...processAndConvertFilter(entity, filterShaper, args, this, context),
        },
      ],
    };

    const where = applyPermission(baseWhere, permissionWhere);

    if (parentConnection) {
      where.$and.push({
        [parentConnection.attribute]: parentConnection.id,
      });
    }

    const qBuilder = manager
      .createQueryBuilder(storageTableName, storageTableName)
      .select('COUNT(*)');

    const transformFn = transformFilterAttributeName(
      context,
      entity,
      modelRegistry,
    );
    buildWhereQuery(
      qBuilder,
      where,
      entityName,
      modelRegistry,
      true,
      transformFn,
    );

    let result;

    try {
      result = await qBuilder.getRawOne();
    } catch (err) {
      processOrmError(err, storageInstance, qBuilder);
    }

    return parseInt(result.count, 10);
  },

  async mutate(entity, id, args, entityMutation, context) {
    if (!entityMutation) {
      throw new CustomError('Invalid mutation', 'InvalidMutationError');
    }

    const entityName = entity.name;
    const modelRegistry = this.getStorageModels();
    const storageInstance = this.getStorageInstance();
    const {
      dataShaper,
      dataShaperMap,
      filterShaper,
      storageTableName,
      constraints,
    } = modelRegistry[entityName];
    const { name: primaryAttributeName } = entity.getPrimaryAttribute();

    const data =
      entityMutation.type !== MUTATION_TYPE_DELETE
        ? serializeValues(
            entity,
            entityMutation,
            args,
            modelRegistry[entityName],
            context,
          )
        : null;

    if (data) {
      deleteUndefinedProps(data);

      const knownAttributes = Object.keys(dataShaperMap);
      Object.keys(data).forEach(
        key => !knownAttributes.includes(key) && delete data[key],
      );
    }

    const manager = storageInstance.manager;

    let permissionWhere = await handlePermission(
      context,
      entity,
      PERMISSION_TYPES.mutation,
      entityMutation,
      data,
    );
    if (permissionWhere) {
      permissionWhere = filterShaper(permissionWhere);
    }

    if (entityMutation.type === MUTATION_TYPE_CREATE) {
      let result;

      if (permissionWhere && permissionWhere.$or) {
        const [query, queryParams] = preMutationPermissionCheckQueryGenerator(
          this,
          permissionWhere,
          entityName,
          modelRegistry,
        );
        const preMutationPermissionCheck = await manager.query(
          query,
          queryParams,
        );

        if (!preMutationPermissionCheck[0].found) {
          throw buildMutationDeniedError(entityMutation.name);
        }
      }

      const qBuilder = manager
        .createQueryBuilder()
        .insert()
        .into(storageTableName)
        .values(data)
        .returning('*');

      try {
        result = await qBuilder.execute();
      } catch (err) {
        processOrmError(err, storageInstance, qBuilder, constraints);
      }

      return parseValues(
        entity,
        dataShaper(result.raw[0]),
        modelRegistry[entityName],
        context,
      );
    } else if (entityMutation.type === MUTATION_TYPE_UPDATE) {
      let result;
      const baseWhere = {
        $and: [
          {
            [primaryAttributeName]: id,
          },
        ],
      };

      extendWithFromStateCheck(baseWhere, entity, entityMutation);

      const where = applyPermission(baseWhere, permissionWhere);

      if (isMap(data.i18n, true)) {
        const i18nSerialized = JSON.stringify(data.i18n).replace(/\'/g, "''");
        data.i18n = () => `merge_translations(i18n, '${i18nSerialized}')`;
      } else {
        delete data.i18n;
      }

      const qBuilder = manager
        .createQueryBuilder()
        .update(storageTableName)
        .set(data)
        .returning('*');

      buildWhereQuery(qBuilder, where, entityName, modelRegistry);

      try {
        result = await qBuilder.execute();
      } catch (err) {
        processOrmError(err, storageInstance, qBuilder, constraints);
      }

      const rowCount = result.raw.length;

      if (rowCount < 1) {
        if (permissionWhere) {
          throw buildInstanceNotFoundOrAccessDeniedError(id);
        }

        throw buildInstanceNotFoundError(id);
      }

      return parseValues(
        entity,
        dataShaper(result.raw[0]),
        modelRegistry[entityName],
        context,
      );
    } else if (entityMutation.type === MUTATION_TYPE_DELETE) {
      let result;
      const baseWhere = {
        $and: [
          {
            [primaryAttributeName]: id,
          },
        ],
      };

      extendWithFromStateCheck(baseWhere, entity, entityMutation);

      const where = applyPermission(baseWhere, permissionWhere);

      const qBuilder = manager
        .createQueryBuilder()
        .delete()
        .from(storageTableName)
        .returning('*');

      buildWhereQuery(qBuilder, where, entityName, modelRegistry);

      try {
        result = await qBuilder.execute();
      } catch (err) {
        processOrmError(err, storageInstance, qBuilder, constraints);
      }

      const rowCount = result.raw.length;

      if (rowCount < 1) {
        if (permissionWhere) {
          throw buildInstanceNotFoundOrAccessDeniedError(id);
        }

        throw buildInstanceNotFoundError(id);
      }

      return {
        deleteRowCount: rowCount,
        [primaryAttributeName]: id,
        rows: result.raw.map(dataShaper),
      };
    }

    return null;
  },

  async checkLookupPermission(entity, filter) {
    const storageInstance = this.getStorageInstance();
    const manager = storageInstance.manager;
    const modelRegistry = this.getStorageModels();

    const entityName = entity.name;
    const { filterShaper, storageTableName } = modelRegistry[entityName];

    const permissionWhere = filterShaper(filter);

    const qBuilder = manager
      .createQueryBuilder(storageTableName, storageTableName)
      .select('COUNT(*) > 0 AS found');

    buildWhereQuery(qBuilder, permissionWhere, entityName, modelRegistry, true);

    let result;

    try {
      result = await qBuilder.getRawOne();
    } catch (err) {
      processOrmError(err, storageInstance, qBuilder);
    }

    return result.found;
  },
});

export default StorageTypePostgres;

StorageTypePostgres.addDataTypeMap(DataTypeID, StorageDataTypeBigInt);
StorageTypePostgres.addDataTypeMap(DataTypeInteger, StorageDataTypeInteger);
StorageTypePostgres.addDataTypeMap(DataTypeBigInt, StorageDataTypeBigInt);
StorageTypePostgres.addDataTypeMap(DataTypeFloat, StorageDataTypeNumeric);
StorageTypePostgres.addDataTypeMap(DataTypeBoolean, StorageDataTypeBoolean);
StorageTypePostgres.addDataTypeMap(DataTypeString, StorageDataTypeText);
StorageTypePostgres.addDataTypeMap(DataTypeJson, StorageDataTypeJSON);
StorageTypePostgres.addDataTypeMap(DataTypeTimestamp, StorageDataTypeTimestamp);
StorageTypePostgres.addDataTypeMap(
  DataTypeTimestampTz,
  StorageDataTypeTimestampTz,
);
StorageTypePostgres.addDataTypeMap(DataTypeDate, StorageDataTypeDate);
StorageTypePostgres.addDataTypeMap(DataTypeTime, StorageDataTypeTime);
StorageTypePostgres.addDataTypeMap(DataTypeTimeTz, StorageDataTypeTimeTz);
StorageTypePostgres.addDataTypeMap(DataTypeUUID, StorageDataTypeUUID);
StorageTypePostgres.addDataTypeMap(DataTypeI18n, StorageDataTypeI18n);

StorageTypePostgres.addDynamicDataTypeMap(
  isDataTypeEnum,
  StorageDataTypeInteger,
);
StorageTypePostgres.addDynamicDataTypeMap(
  isDataTypeState,
  StorageDataTypeInteger,
);

StorageTypePostgres.addDynamicDataTypeMap(
  isObjectDataType,
  StorageDataTypeJSON,
);
StorageTypePostgres.addDynamicDataTypeMap(isListDataType, StorageDataTypeJSON);
