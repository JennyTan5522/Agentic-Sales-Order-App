from langchain_openai import ChatOpenAI

def get_openai_client(api_key: str, model_name: str = "gpt-4", temperature: float = 0.0):
    """
    Initialize and return an OpenAI Chat LLM client.

    Args:
        api_key (str): OpenAI API key.
        model_name (str): Model name to use (default: "gpt-4").
        temperature (float): Sampling temperature (default: 0.0).
    
    Returns:
        ChatOpenAI: Configured OpenAI Chat LLM client.
    """
    return ChatOpenAI(
        model=model_name,
        temperature=temperature,
        openai_api_key=api_key
    )
