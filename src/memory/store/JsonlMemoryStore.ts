import * as fs from 'fs';
import * as path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import { MemoryStore, Observation, MemoryQuery } from './MemoryStore.js';
import { KnowledgeGraph, Entity, Relation } from '../knowledgeGraph.js';
import { createDirectory } from '../../utils/fs.js';

/**
 * Enhanced version of Entity with observation objects instead of strings
 */
interface EnhancedEntity extends Omit<Entity, 'observations'> {
  observations: Observation[];
}

/**
 * JSONL implementation of the MemoryStore interface
 */
export class JsonlMemoryStore implements MemoryStore {
  private filePath: string;
  private graph: KnowledgeGraph;
  private isLoading: boolean = false;
  private loadPromise: Promise<void> | null = null;
  private enhancedEntities: Map<string, EnhancedEntity> = new Map();
  private entityRelations: Map<string, Set<Relation>> = new Map();
  private autoLinkEnabled: boolean = false;

  /**
   * Create a new JsonlMemoryStore instance
   * @param filePath - Path to the storage file
   */
  constructor(filePath: string) {
    this.filePath = filePath;
    this.graph = new KnowledgeGraph();
    this.autoLinkEnabled = process.env.AUTO_LINK === 'true';
    this.loadPromise = this.load();
  }

  /**
   * Get the knowledge graph instance
   * @returns The knowledge graph instance
   */
  getGraph(): KnowledgeGraph {
    return this.graph;
  }

  /**
   * Add a new observation to the store
   * @param entityName - Entity to associate the observation with
   * @param text - The observation text
   * @param metadata - Optional metadata for the observation
   * @returns The stored observation with generated metadata
   */
  async add(entityName: string, text: string, metadata?: {
    version?: string;
    tags?: string[];
    agent?: string;
  }): Promise<Observation> {
    await this.getLoadingPromise();

    // Create observation with timestamp
    const observation: Observation = {
      text,
      timestamp: new Date().toISOString(),
      version: metadata?.version
    };

    // Get entity or create if it doesn't exist
    let entity = this.enhancedEntities.get(entityName);
    let isNewEntity = false;
    if (!entity) {
      entity = {
        name: entityName,
        entityType: 'default', // Default type if entity doesn't exist
        observations: []
      };
      this.enhancedEntities.set(entityName, entity);
      isNewEntity = true;

      // Also add to the graph for backward compatibility
      this.graph.addEntity({
        name: entityName,
        entityType: 'default',
        observations: []
      });
    }

    // Add observation to entity
    entity.observations.push(observation);

    // Update graph for backward compatibility
    this.graph.addObservations(entityName, [text]);

    // If this is a new entity and auto-linking is enabled, create relationships
    if (isNewEntity && this.autoLinkEnabled) {
      await this.createAutoLinks(entityName, text);
    }

    // Save changes
    await this.save();

    return observation;
  }

  /**
   * Create automatic relationships between entities based on heuristics
   * @param entityName - Name of the entity to link
   * @param observationText - Text of the observation that might contain relationship clues
   */
  private async createAutoLinks(entityName: string, observationText: string): Promise<void> {
    // Skip if no observation text
    if (!observationText) return;

    // Get all existing entities except the current one
    const existingEntities = Array.from(this.enhancedEntities.keys())
      .filter(name => name !== entityName);

    // No need to proceed if there are no other entities
    if (existingEntities.length === 0) return;

    const relationsCreated: Relation[] = [];
    const entityWords = entityName.toLowerCase().split(/\s+/);
    const observationWords = observationText.toLowerCase().split(/\s+/);

    // Check each existing entity for potential relationships
    for (const otherEntityName of existingEntities) {
      const otherEntity = this.enhancedEntities.get(otherEntityName);
      if (!otherEntity) continue;

      // Skip if the entities have the same name (case-insensitive)
      if (entityName.toLowerCase() === otherEntityName.toLowerCase()) continue;

      // Heuristic 1: Check if one entity name contains the other
      if (entityName.toLowerCase().includes(otherEntityName.toLowerCase())) {
        // This entity might be a subtype or specialized version of the other
        relationsCreated.push({
          from: entityName,
          to: otherEntityName,
          relationType: 'is_a'
        });
      } else if (otherEntityName.toLowerCase().includes(entityName.toLowerCase())) {
        // The other entity might be a subtype or specialized version of this one
        relationsCreated.push({
          from: otherEntityName,
          to: entityName,
          relationType: 'is_a'
        });
      }

      // Heuristic 2: Check for entity name words in observation text
      const otherEntityWords = otherEntityName.toLowerCase().split(/\s+/);
      if (observationWords.some(word => otherEntityWords.includes(word))) {
        // This entity's observation mentions the other entity
        relationsCreated.push({
          from: entityName,
          to: otherEntityName,
          relationType: 'references'
        });
      }

      // Heuristic 3: Check for common words in entity names
      const commonWords = entityWords.filter(word => 
        word.length > 3 && otherEntityWords.includes(word)
      );
      if (commonWords.length > 0) {
        // Entities share common words, might be related
        relationsCreated.push({
          from: entityName,
          to: otherEntityName,
          relationType: 'related_to'
        });
      }

      // Heuristic 4: Check for "uses" or "needs" in observations
      if (observationText.toLowerCase().includes('uses') && 
          observationText.toLowerCase().includes(otherEntityName.toLowerCase())) {
        relationsCreated.push({
          from: entityName,
          to: otherEntityName,
          relationType: 'uses'
        });
      }

      // Heuristic 5: Check for "belongs to" or "part of" in observations
      if ((observationText.toLowerCase().includes('belongs to') || 
           observationText.toLowerCase().includes('part of')) && 
          observationText.toLowerCase().includes(otherEntityName.toLowerCase())) {
        relationsCreated.push({
          from: entityName,
          to: otherEntityName,
          relationType: 'belongs_to'
        });
      }
    }

    // Add unique relations to the graph
    for (const relation of relationsCreated) {
      this.graph.addRelation(relation);
      
      // Also store in our internal map
      if (!this.entityRelations.has(relation.from)) {
        this.entityRelations.set(relation.from, new Set());
      }
      this.entityRelations.get(relation.from)?.add(relation);
    }

    // Log auto-linking results if debug is enabled
    if (process.env.MCP_DEBUG === 'true' && relationsCreated.length > 0) {
      console.error(`Auto-linked entity "${entityName}" with ${relationsCreated.length} relations.`);
    }
  }

  /**
   * Query observations based on filter criteria
   * @param query - Query parameters
   * @returns Array of matching observations with their entity names
   */
  async query(query: MemoryQuery): Promise<{
    entityName: string;
    observation: Observation;
  }[]> {
    await this.getLoadingPromise();

    const results: { entityName: string; observation: Observation }[] = [];
    const keyword = query.keyword?.toLowerCase();

    for (const [entityName, entity] of this.enhancedEntities.entries()) {
      for (const observation of entity.observations) {
        let matches = true;

        // Filter by keyword (matches observation text OR entity name,
        // so namespaced queries like "project:fenix" hit the entity)
        if (keyword && !observation.text.toLowerCase().includes(keyword) && !entityName.toLowerCase().includes(keyword)) {
          matches = false;
        }

        // Filter by time range
        if (query.time) {
          const obsTime = new Date(observation.timestamp).getTime();
          if (query.time.after && obsTime < new Date(query.time.after).getTime()) {
            matches = false;
          }
          if (query.time.before && obsTime > new Date(query.time.before).getTime()) {
            matches = false;
          }
        }

        // Filter by tag (would require additional metadata tracking)
        // This is a placeholder for future implementation
        if (query.tag) {
          // Not implemented yet
          // For now, we'll just check if the tag appears in the text
          if (!observation.text.toLowerCase().includes(query.tag.toLowerCase())) {
            matches = false;
          }
        }

        // Filter by agent (would require additional metadata tracking)
        // This is a placeholder for future implementation
        if (query.agent) {
          // Not implemented yet
          matches = false;
        }

        if (matches) {
          results.push({
            entityName,
            observation
          });
        }
      }
    }

    // Apply limit if specified
    if (query.limit && query.limit > 0) {
      return results.slice(0, query.limit);
    }

    return results;
  }

  /**
   * Prune observations from the store
   * @param options - Pruning options
   * @returns Count of pruned observations
   */
  async prune(options: {
    before?: string;
    tag?: string;
    deprecate?: boolean;
  }): Promise<number> {
    await this.getLoadingPromise();

    let prunedCount = 0;
    const beforeTime = options.before ? new Date(options.before).getTime() : 0;

    for (const [entityName, entity] of this.enhancedEntities.entries()) {
      const originalLength = entity.observations.length;
      
      if (options.deprecate) {
        // Mark observations as deprecated rather than removing them
        for (const observation of entity.observations) {
          const obsTime = new Date(observation.timestamp).getTime();
          
          if (beforeTime && obsTime < beforeTime) {
            // If the observation contains the tag we're looking for or no tag specified
            if (!options.tag || observation.text.includes(options.tag)) {
              // Mark as deprecated by prepending [DEPRECATED] to the text
              if (!observation.text.startsWith('[DEPRECATED]')) {
                observation.text = `[DEPRECATED] ${observation.text}`;
                prunedCount++;
              }
            }
          }
        }
      } else {
        // Remove observations that match the pruning criteria
        entity.observations = entity.observations.filter(observation => {
          const obsTime = new Date(observation.timestamp).getTime();
          
          // If before time is specified and observation is older, consider for pruning
          if (beforeTime && obsTime < beforeTime) {
            // If the observation contains the tag we're looking for or no tag specified
            if (!options.tag || observation.text.includes(options.tag)) {
              prunedCount++;
              return false; // Remove this observation
            }
          }
          
          return true; // Keep this observation
        });
      }

      // If entity has no observations and was pruned, remove it
      if (entity.observations.length === 0 && originalLength > 0) {
        this.enhancedEntities.delete(entityName);
        this.graph.deleteEntity(entityName);
      }
    }

    // If any observations were pruned, save changes
    if (prunedCount > 0) {
      await this.save();
    }

    return prunedCount;
  }

  /**
   * Find similar entity names based on the provided name
   * @param name - The name to find similar entities for
   * @returns Array of similar entity names
   */
  async findSimilar(name: string): Promise<string[]> {
    await this.getLoadingPromise();

    const results: string[] = [];
    const normalizedName = name.toLowerCase().trim();
    
    // Direct exact match (case-insensitive)
    for (const entityName of this.enhancedEntities.keys()) {
      // First check for exact match
      if (entityName.toLowerCase() === normalizedName) {
        return [entityName]; // Return immediately for exact matches
      }
      
      // Check for contains in either direction
      if (entityName.toLowerCase().includes(normalizedName) || 
          normalizedName.includes(entityName.toLowerCase())) {
        results.push(entityName);
        continue;
      }
      
      // Check for word-level matches
      const entityWords = entityName.toLowerCase().split(/\s+/);
      const searchWords = normalizedName.split(/\s+/);
      
      // If any word matches, consider it similar
      const hasWordMatch = entityWords.some(word => 
        searchWords.some(searchWord => word === searchWord && word.length > 2)
      );
      
      if (hasWordMatch) {
        results.push(entityName);
      }
    }
    
    return results;
  }

  /**
   * Get the loading promise
   * @returns Promise that resolves when loading is complete
   */
  getLoadingPromise(): Promise<void> {
    return this.loadPromise || Promise.resolve();
  }

  /**
   * Load the graph from the file (JSONL only) using streaming for better performance
   * @returns Promise resolving when loading is complete
   */
  async load(): Promise<void> {
    if (this.isLoading) {
      return this.loadPromise as Promise<void>;
    }

    this.isLoading = true;
    this.loadPromise = new Promise<void>((resolve) => {
      try {
        // Ensure directory exists
        createDirectory(path.dirname(this.filePath));
        
        if (fs.existsSync(this.filePath)) {
          // Clear existing data
          this.graph.entities.clear();
          this.graph.relations.clear();
          this.enhancedEntities.clear();
          this.entityRelations.clear();
          
          // Create read stream and readline interface
          const fileStream = createReadStream(this.filePath, { encoding: 'utf8' });
          const rl = createInterface({
            input: fileStream,
            crlfDelay: Infinity
          });

          let lineCount = 0;
          
          // Process each line as it's read
          rl.on('line', (line) => {
            if (!line.trim()) return; // Skip empty lines
            
            try {
              const obj = JSON.parse(line);
              
              if (obj._type === 'entity') {
                // Handle legacy format (string observations)
                if (obj.observations && Array.isArray(obj.observations)) {
                  // Add to graph for backward compatibility
                  this.graph.addEntity({
                    name: obj.name,
                    entityType: obj.entityType,
                    observations: obj.observations
                  });
                  
                  // Convert string observations to enhanced format
                  const enhancedEntity: EnhancedEntity = {
                    name: obj.name,
                    entityType: obj.entityType,
                    observations: obj.observations.map((obs: string | Observation) => {
                      if (typeof obs === 'string') {
                        // Convert legacy string observation to object
                        return {
                          text: obs,
                          timestamp: new Date().toISOString()
                        };
                      } else {
                        // Already in the right format
                        return obs;
                      }
                    })
                  };
                  
                  this.enhancedEntities.set(obj.name, enhancedEntity);
                }
              } else if (obj._type === 'relation') {
                this.graph.addRelation(obj);
                
                // Store relation in our internal map too
                if (!this.entityRelations.has(obj.from)) {
                  this.entityRelations.set(obj.from, new Set());
                }
                this.entityRelations.get(obj.from)?.add(obj);
              }
              
              lineCount++;
            } catch (err) {
              console.error(`Error parsing line in memory file: ${err}`);
            }
          });
          
          // When file is completely read
          rl.on('close', () => {
            // Removed debug log
            this.isLoading = false;
            resolve();
          });
          
          // Handle errors
          fileStream.on('error', (error) => {
            console.error(`Error reading memory file: ${error}`);
            this.isLoading = false;
            resolve(); // Resolve anyway to prevent hanging
          });
        } else {
          // Create an empty file if it doesn't exist
          fs.writeFileSync(this.filePath, '', 'utf8');
          // Removed debug log
          this.isLoading = false;
          resolve();
        }
      } catch (error) {
        console.error(`Error loading memory: ${error}`);
        this.isLoading = false;
        resolve(); // Resolve anyway to prevent hanging
      }
    });
    
    return this.loadPromise;
  }

  /**
   * Save the graph to the file in JSONL format
   */
  async save(): Promise<void> {
    try {
      const lines: string[] = [];
      
      // Save enhanced entities
      for (const entity of this.enhancedEntities.values()) {
        lines.push(JSON.stringify({ 
          ...entity, 
          _type: 'entity',
          _savedAt: new Date().toISOString()
        }));
      }
      
      // Save relations
      for (const relSet of this.entityRelations.values()) {
        for (const relation of relSet) {
          lines.push(JSON.stringify({ 
            ...relation, 
            _type: 'relation',
            _savedAt: new Date().toISOString()
          }));
        }
      }
      
      // Write to file
      fs.writeFileSync(this.filePath, lines.join('\n') + '\n', 'utf8');
      // Removed debug log
      
      return Promise.resolve();
    } catch (error) {
      console.error(`Error saving memory: ${error}`);
      return Promise.reject(error);
    }
  }

  /**
   * Backward compatibility method: Add a new entity to the graph
   * @param entity - The entity to add
   * @returns Promise resolving to true if the entity was added, false if it already exists
   */
  async addEntity(entity: Entity): Promise<boolean> {
    await this.getLoadingPromise();
    
    // Use the underlying graph for backward compatibility
    const result = this.graph.addEntity(entity);
    
    // If entity was added, also add it to our enhanced entities
    if (result && !this.enhancedEntities.has(entity.name)) {
      this.enhancedEntities.set(entity.name, {
        name: entity.name,
        entityType: entity.entityType,
        observations: entity.observations.map(text => ({
          text,
          timestamp: new Date().toISOString()
        }))
      });
    }
    
    return result;
  }
  
  /**
   * Backward compatibility method: Add a new relation between entities
   * @param relation - The relation to add
   * @returns Promise resolving to true if the relation was added, false if invalid or already exists
   */
  async addRelation(relation: Relation): Promise<boolean> {
    await this.getLoadingPromise();
    
    // Use the underlying graph for backward compatibility
    const result = this.graph.addRelation(relation);
    
    // If relation was added, also add it to our entity relations map
    if (result) {
      if (!this.entityRelations.has(relation.from)) {
        this.entityRelations.set(relation.from, new Set());
      }
      this.entityRelations.get(relation.from)?.add(relation);
    }
    
    return result;
  }
} 