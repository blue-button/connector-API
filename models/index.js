var exports = module.exports = {
  apps : {
    definition : {
      "name":         {dataType: "string"},
      "organization": {dataType: "string"},
      "url":          {dataType: "string"},
      "description":  {dataType: "string"},
      "img":          {dataType: "string"},
      "apple_url":    {dataType: "string"},
      "google_url":   {dataType: "string"}
    },
    create : function(obj) {
      if (!obj.name || obj.name == "") return {error: 'no empty name'};
      var validated = validate(obj, this.definition, {});
      validated.id = safeId(validated.name);
      if (typeof obj.updated == "undefined") {
        validated.updated = Date();
      } else {
        validated.updated = obj.updated;
      }
      return validated;
    }
  },

  organizations : {
    definition : {
     "organization":     {dataType: "string"},
      "category":        {dataType: "string"},
      "states":          {dataType: "array"},
      "phone":           {dataType: "string"},
      "url": {
        "login":         {dataType: "string"},
        "logo":          {dataType: "string"},
        "mobile":        {dataType: "string"},
        "screenshot":    {dataType: "string"},
        "web":           {dataType: "string"}
      },
      "description":     {dataType: "string"},
      "bb_logo":         {dataType: "boolean"},
      "view": {
        "active_prescriptions": {dataType: "boolean"},
        "allergies":            {dataType: "boolean"},
        "appointment_history":  {dataType: "boolean"},
        "claims":               {dataType: "boolean"},
        "diagnostics":          {dataType: "boolean"},
        "family_history":       {dataType: "boolean"},
        "imaging":              {dataType: "boolean"},
        "immunizations":        {dataType: "boolean"},
        "lab_results":          {dataType: "boolean"},
        "medical_history":      {dataType: "boolean"},
        "medications":          {dataType: "boolean"},
        "pathology":            {dataType: "boolean"},
        "prescriptions":        {dataType: "boolean"},
        "problems":             {dataType: "boolean"},
        "visit_history":        {dataType: "boolean"},
        "vitals":               {dataType: "boolean"}
      },
      "download": {
        "text":  {dataType: "boolean"},
        "pdf":   {dataType: "boolean"},
        "c32":   {dataType: "boolean"},
        "ccda":  {dataType: "boolean"},
        "other": {dataType: "boolean"}
      },
      "transmit": {
        "direct": {
          "enabled":    {dataType: "boolean"},
          "trust_bundles": {
            "patient":  {dataType: "boolean"},
            "provider": {dataType: "boolean"},
            "other":    {dataType: "boolean"}
          }
        }
      },
      "services": {
        "refills":                {dataType: "boolean"},
        "automatic_refills":      {dataType: "boolean"},
        "transfer_prescriptions": {dataType: "boolean"},
        "bill_pay":               {dataType: "boolean"},
        "caregiving":             {dataType: "boolean"},
        "dispute":                {dataType: "boolean"},
        "family_prescriptions":   {dataType: "boolean"},
        "new_prescriptions":      {dataType: "boolean"},
        "open_notes":             {dataType: "boolean"},
        "reminders":              {dataType: "boolean"},
        "scheduling":             {dataType: "boolean"},
        "search":                 {dataType: "boolean"},
        "secure_messaging":       {dataType: "boolean"},
        "self_entered":           {dataType: "boolean"},
        "shop":                   {dataType: "boolean"},
        "test_request":           {dataType: "boolean"},
        "email_alerts":           {dataType: "boolean"}
      }
    },
    create : function(obj) {
      if (!obj.organization || obj.organization == "") return {error: 'no empty organization'};
      var validated = validate(obj, this.definition, {});
      validated.id = safeId(validated.organization);
      if (typeof obj.updated == "undefined") {
        validated.updated = Date();
      } else {
        validated.updated = obj.updated;
      }

      return validated;
    }
  }
};


////////////////////////////////////////////////////////// HELPERS

function validate(toValidate, ref, retObj) {
  for (var p in ref) {
    if (typeof ref[p].dataType === "undefined") {
      retObj[p] = {};
      if (!toValidate[p]) toValidate[p] = {};
      validate(toValidate[p], ref[p], retObj[p]);
    } else {
      if (typeof toValidate === "undefined") toValidate = {};
      var trimmed = trim(toValidate[p]);
      retObj[p] = typeEnforcer(ref[p].dataType, trimmed);
    }
  }
  return retObj;
}

function typeEnforcer(type, val){
  var validVal;
  switch (type) {
    case "boolean":
      if (typeof val === "string") {
        validVal = val.toLowerCase() === "true";
      } else {
        validVal = !!val;
      }
      break;
    case "string":
      if ( (val === null) || (val === "undefined") || (typeof val === "undefined") ) {
        validVal = '';
      } else {
        validVal = trim(String(val));
      }
      break;
    case "array":
      if (typeof val === 'undefined' || val === null) {
        validVal = [];
      } else if (Array.isArray(val)) {
        validVal = [];
        val.forEach(function(v) {
          validVal.push(trim(v));
        });
      } else {
        validVal = [trim(val)];
      }
      break;
    case "integer":
      var asInt = parseInt(val, 10);
      if (isNaN(asInt)) asInt = 0;
      validVal = asInt;
      break;
    case "number":
      var asNum = parseFloat(val);
      if (isNaN(asNum)) asNum = 0;
      validVal = asNum;
      break;
  }
  return validVal;
}


function trim(s) {
  if (typeof s === 'string') return s.trim();
  return s;
}

function safeId(s) {
  return trim(s).toLowerCase().replace(/[^a-zA-Z0-9]+/g, '-').replace(/\-+$/, '');
}