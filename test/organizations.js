process.env.NODE_ENV = 'test';
process.env.CONFIG_FILE = __dirname + '/config.json';
var localConfig = require(process.env.CONFIG_FILE);

var should = require('chai').should();
var app = require('../server.js').app;
var request = require('supertest')(app);

describe('ORGANIZATIONS', function(){
  // let's be a little bit careful, shall we?
  if ( process.env.NODE_ENV !== 'test' ) {
    console.log("Oops, you want NODE_ENV=test before you try this again!");
    process.exit(1);
  }

  describe('Create', function(){

    var fakeOrganization = {
      description: "This fake organization does some amazing (fake) things for your health.",
      organization: "Some fake organization",
      submitter_email: "example@example.com",
      submitter_reason: "I work for the company",
      url: "http://www.fakeorganization.com"
    }
    var pendingId;

    afterEach(function(done){
      request
        .get('/pending/organizations/'+pendingId+'?action=reject')
        .auth(localConfig.ADMIN_USER, localConfig.ADMIN_PASSWORD)
        .set('Accept', 'application/json')
        .end(done);
    });

    it('should create a pending organization', function (done){
      request
        .post('/organizations')
        .send(fakeOrganization)
        .end(function(err, res) {
          if (err) return done(err);
          res.body.should.be.instanceof(Object).and.have.keys('success', 'saved');
          pendingId = res.body.saved._id;
          done();
        });
    });

    it('should not allow extra properties', function (done){
      fakeOrganization.bad_property = "Mwuhahahah!";
      fakeOrganization.url = {bad_url:"http://1336h4x0rz.com"};
      request
        .post('/organizations')
        .send(fakeOrganization)
        .end(function(err, res) {
          if (err) return done(err);
          res.body.should.be.instanceof(Object).and.have.keys('success', 'saved');
          res.body.saved.url.should.be.instanceof(Object).and.not.have.key('bad_url');
          pendingId = res.body.saved._id;
          done();
        });
    });

    it('should not allow a blank organization', function (done){
      delete fakeOrganization.organization;
      request
        .post('/organizations')
        .send(fakeOrganization)
        .expect(400, done);
    });

  });


  describe('PENDING', function(){

    describe('handling erroneous requests', function(done) {

      it('should not allow access without correct creds', function (done){
        request
          .get('/pending/organizations/012345678910?action=reject')
          .auth('incorrect', 'credentials')
          .set('Accept', 'application/json')
          .expect(401, done);
      });

      it('should return proper error on incorrect params', function (done){
        request
          .get('/pending/organizations/012345678910?action=rejectt')
          .auth(localConfig.ADMIN_USER, localConfig.ADMIN_PASSWORD)
          .set('Accept', 'application/json')
          .expect(400, done);
      });

      it('should return proper error if organization isn\'t found', function (done){
        request
          .get('/pending/organizations/012345678910?action=reject')
          .auth(localConfig.ADMIN_USER, localConfig.ADMIN_PASSWORD)
          .set('Accept', 'application/json')
          .expect(404, done);
      });

    });

    describe('admin actions', function() {

      var fakeOrganization = {
        description: "This fake organization does some amazing (fake) things for your health.",
        organization: "Another fake organization",
        submitter_email: "example@example.com",
        submitter_reason: "I work for the company",
        url: {
          login: "http://www.anotherfakeorganization.com"
        }
      }
      var pendingId;

      beforeEach(function(done){
        request
          .post('/organizations')
          .send(fakeOrganization)
          .end(function(err, res) {
            if (err) return done(err);
            res.body.should.be.instanceof(Object).and.have.keys('success', 'saved');
            pendingId = res.body.saved._id;
            done();
          });
      });

      afterEach(function(done) {
        request
          .get('/pending/organizations/'+pendingId+'?action=reject')
          .auth(localConfig.ADMIN_USER, localConfig.ADMIN_PASSWORD)
          .set('Accept', 'application/json')
          .end(done);
      });

      it('should show the pending organization', function (done){
        request
          .get('/pending/organizations/'+pendingId)
          .auth(localConfig.ADMIN_USER, localConfig.ADMIN_PASSWORD)
          .end(function(err, res) {
            if (err) return done(err);
            res.text.should.contain('Submitted by:');
            res.text.should.contain('attribute');
            done();
          });
      });

      it('should reject the pending organization', function (done){
        request
          .get('/pending/organizations/'+pendingId+'?action=reject')
          .auth(localConfig.ADMIN_USER, localConfig.ADMIN_PASSWORD)
          .set('Accept', 'application/json')
          .expect(200, done);
      });

      it('should approve the pending organization', function (done){
        request
          .get('/pending/organizations/'+pendingId+'?action=approve')
          .auth(localConfig.ADMIN_USER, localConfig.ADMIN_PASSWORD)
          .set('Accept', 'application/json')
          .expect(200)
          .end(function(err, res) {
            if (err) return done(err);
            res.text.should.contain('Approved. Changes will show up on the live site within 24 hours.');
            done();
          });
      });

    });

  });

  describe('GET ', function(){

    after(function(done) {
      request
        .post('/organizations/another-fake-organization')
        .auth(localConfig.ADMIN_USER, localConfig.ADMIN_PASSWORD)
        .send({_method:'delete'})
        .expect(200)
        .end(function(err, res) {
          if (err) return done(err);
          res.text.should.contain('BALETED');
          done();
        });
    });

    it('should show the approved organization', function (done){
      request
        .get('/organizations/another-fake-organization')
        .set('Accept', 'application/json')
        .expect(200)
        .end(function(err, res) {
          if (err) return done(err);
          res.body.should.be.instanceof(Object).and.contain.keys('organization', 'id');
          res.body.id.should.equal('another-fake-organization');
          done();
        });
    });

    it('should respect limit', function (done){
      request
        .get('/organizations?limit=1')
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          if (err) return done(err);
          res.body.should.be.instanceof(Object).and.have.keys('results', 'meta');
          res.body.results.should.be.instanceof(Array).and.have.length(1);
          done();
        });
    });

  });


});