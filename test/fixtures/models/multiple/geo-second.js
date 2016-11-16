
'use strict';

module.exports = {

  domain: 'geo',

  entities: [

    {
      name: 'continent',
      description: 'A continent on our beautiful planet',

      attributes: [

        {
          name: 'name',
          type: 'text',
          description: 'The name of the continent',
          minLength: 1
        },

        {
          name: 'iso_code',
          type: 'text',
          description: 'ISO code of the country',
          pattern: '^[a-z]+$',
          minLength: 3,
          maxLength: 3
        }

      ],

      indexing: {
        unique: [
          [ 'name' ]
        ]
      }

    }
  ]
}
