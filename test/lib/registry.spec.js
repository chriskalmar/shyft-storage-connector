
'use strict';

const registry = require('../../').registry



describe('registry', function() {


  it('should store core components', function() {

    registry.setCoreComponent('example', function() {}, './test/fixtures/templates/empty.marko')

    expect(registry.components.core).to.have.property('example')
  })



  it('should reject core components with missing or non-function processors', function() {

    function fn() {
      registry.setCoreComponent('example', null, './test/fixtures/templates/empty.marko')
    }

    expect(fn).to.throw(/requires processor to be a function/);
  })



  it('should reject core components where the template path does not exist', function() {

    function fn() {
      registry.setCoreComponent('example', function() {}, '/tmp/-no-file-here.marko')
    }

    expect(fn).to.throw(/could not find template/);
  })

})