import { describe, it, expect, afterAll } from "vitest";
import {
  SystemLanguageModel,
  LanguageModelSession,
  GenerationSchema,
  GenerationGuide,
  InvalidGenerationSchemaError,
  generable,
  type JsonSchema,
} from "../../src/index.js";

const model = new SystemLanguageModel();
const { available } = await model.waitUntilAvailable(5_000);
const describeIfAvailable = available ? describe : describe.skip;

afterAll(() => model.dispose());

describeIfAvailable("structured output (integration)", () => {
  it("generates content matching schema", async () => {
    const schema = new GenerationSchema("Color", "A color")
      .property("name", "string", {
        description: "Color name",
        guides: [GenerationGuide.anyOf(["red", "blue", "green"])],
      })
      .property("isPrimary", "boolean", {
        description: "Whether this is a primary color",
      });

    const session = new LanguageModelSession();
    const { content } = await session.respondWithSchema("Pick a color", schema);
    const name = content.value<string>("name");
    expect(["red", "blue", "green"]).toContain(name);
    const isPrimary = content.value<boolean>("isPrimary");
    expect(typeof isPrimary).toBe("boolean");
    session.dispose();
  }, 30_000);

  it("generates content from JSON schema", async () => {
    const schema = new GenerationSchema("YesNo", "A yes or no answer").property(
      "answer",
      "string",
      {
        guides: [GenerationGuide.anyOf(["yes", "no"])],
      },
    );

    const session = new LanguageModelSession();
    const { content } = await session.respondWithJsonSchema("Is the sky blue?", schema.toDict());
    const obj = content.toObject();
    expect(obj).toHaveProperty("answer");
    expect(["yes", "no"]).toContain(obj.answer);
    session.dispose();
  }, 30_000);

  it("generates nested objects with generable()", async () => {
    const Order = generable("Order", {
      customer: {
        type: "object",
        properties: {
          name: { type: "string" },
          address: { type: "object", properties: { city: { type: "string" } } },
        },
      },
      items: {
        type: "array",
        items: { type: "object", properties: { sku: { type: "string" } } },
      },
    });
    const session = new LanguageModelSession();
    const { content } = await session.respondWithSchema(
      "Make up an order from Ana in Lisbon for two items.",
      Order.schema,
    );
    const order = Order.parse(content);
    expect(typeof order.customer.name).toBe("string");
    expect(typeof order.customer.address.city).toBe("string");
    expect(Array.isArray(order.items)).toBe(true);
    session.dispose();
  }, 60_000);

  it("keeps same-named nested objects apart in generable()", async () => {
    const Order = generable("Order", {
      shipping: {
        type: "object",
        properties: {
          address: { type: "object", properties: { city: { type: "string" } } },
        },
      },
      billing: {
        type: "object",
        properties: {
          address: { type: "object", properties: { postcode: { type: "string" } } },
        },
      },
    });
    const session = new LanguageModelSession();
    const { content } = await session.respondWithSchema(
      "Make up an order shipped to a city, billed to a postcode.",
      Order.schema,
    );
    const order = Order.parse(content);
    expect(typeof order.shipping.address.city).toBe("string");
    expect(typeof order.billing.address.postcode).toBe("string");
    session.dispose();
  }, 60_000);

  it("resolves $ref to $defs in a JSON schema", async () => {
    const session = new LanguageModelSession();
    const { content } = await session.respondWithJsonSchema("Make up a person and their pet.", {
      type: "object",
      properties: { owner: { $ref: "#/$defs/Person" }, pet: { $ref: "#/$defs/Pet" } },
      $defs: {
        Person: { type: "object", properties: { name: { type: "string" } } },
        Pet: { type: "object", properties: { species: { type: "string" } } },
      },
    });
    const value = JSON.parse(content.toJson()) as {
      owner: { name: string };
      pet: { species: string };
    };
    expect(typeof value.owner.name).toBe("string");
    expect(typeof value.pet.species).toBe("string");
    session.dispose();
  }, 60_000);

  it("reports a schema the framework can't build as InvalidGenerationSchemaError", async () => {
    const session = new LanguageModelSession();
    await expect(
      session.respondWithJsonSchema("Make one up.", {
        type: "object",
        properties: { x: { $ref: "#/$defs/Missing" } },
      }),
    ).rejects.toBeInstanceOf(InvalidGenerationSchemaError);
    session.dispose();
  });

  it("rejects a schema nested deeply enough to overflow the framework's stack", async () => {
    let schema: JsonSchema = { type: "string" };
    for (let i = 0; i < 200; i++) schema = { type: "object", properties: { child: schema } };
    const session = new LanguageModelSession();
    await expect(session.respondWithJsonSchema("Make one up.", schema)).rejects.toThrow(
      /nests more than 128 levels/,
    );
    session.dispose();
  });
});
