async def test_scalar_docs_page_is_served(client):
    response = await client.get("/scalar")

    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "/openapi.json" in response.text  # it renders the same schema as /docs
