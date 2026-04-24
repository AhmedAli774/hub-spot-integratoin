const _defaultMappings = [
  { id: '1', wixField: 'primaryInfo.email', hubspotProperty: 'email', direction: 'bidirectional', required: true },
  { id: '2', wixField: 'primaryInfo.phone', hubspotProperty: 'phone', direction: 'bidirectional', required: false },
  { id: '3', wixField: 'name.first', hubspotProperty: 'firstname', direction: 'bidirectional', required: false },
  { id: '4', wixField: 'name.last', hubspotProperty: 'lastname', direction: 'bidirectional', required: false },
  { id: '5', wixField: 'addresses[0].city', hubspotProperty: 'city', direction: 'wix-to-hubspot', required: false },
  { id: '6', wixField: 'addresses[0].country', hubspotProperty: 'country', direction: 'wix-to-hubspot', required: false },
  { id: '7', wixField: 'addresses[0].postalCode', hubspotProperty: 'zip', direction: 'wix-to-hubspot', required: false },
];

let _mappings = [..._defaultMappings];

export function getFieldMappings() {
  return _mappings;
}

export function saveFieldMapping(mapping) {
  const id = mapping.id ?? String(Date.now());
  const direction = mapping.direction ?? 'bidirectional';

  // Validate: no duplicate hubspotProperty (except when updating the same record)
  const duplicate = _mappings.find(
    (m) => m.hubspotProperty === mapping.hubspotProperty && m.id !== id
  );
  if (duplicate) {
    throw new Error(`HubSpot property "${mapping.hubspotProperty}" is already mapped to "${duplicate.wixField}"`);
  }

  const entry = { ...mapping, id, direction };
  const idx = _mappings.findIndex((m) => m.id === id);
  if (idx >= 0) {
    _mappings[idx] = entry;
  } else {
    _mappings.push(entry);
  }
  return entry;
}

export function deleteFieldMapping(id) {
  const before = _mappings.length;
  _mappings = _mappings.filter((m) => m.id !== id);
  return _mappings.length < before;
}

export function resetToDefaults() {
  _mappings = [..._defaultMappings];
}
