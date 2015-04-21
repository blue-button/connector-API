Blue Button "Connector" API.
---

This is the API that drives the [Blue Button Connector site](http://bluebuttonconnector.healthit.gov)

## Documentation
Right here &rarr; [API documentation](http://api.bluebuttonconnector.healthit.gov).

## CORS
Yep, you're covered. That means you can make xhr calls from a (modern) browser and not get hit with Cross-domain restrictions.

## Technical requirements
The API is built on Express 3 (deprecated, for those keeping score at home), backed by MongoDB. The interactive docs are a mod of [I/O Docs](https://github.com/mashery/iodocs), which require Redis.

### Testing
Some basic tests can be run with `npm test.` These run on an actual test db— no mocks. You'll need a `config.json` in the `test/` directory that matches the root `config_sample.json` but with test db info.
